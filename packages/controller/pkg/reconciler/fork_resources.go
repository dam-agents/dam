package reconciler

import (
	"fmt"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

const (
	ForkJobLabelType     = "agent-fork-job"
	ForkLabelForkID      = "agent-platform.ai/fork-id"
	ForkLabelInstanceRef = "agent-platform.ai/instance"
	ForkLabelType        = "agent-platform.ai/type"
)

// BuildForkAgentJob constructs the agent half of the per-turn paired pod
// pair (ADR-038). The fork agent runs the harness; egress credential
// injection happens in the paired fork gateway pod, reached via HTTPS_PROXY.
//
// `credentialSecrets` are the replier's `(owner=foreignSub, connection=*)`
// K8s Secrets — the instance owner's Secrets must NOT appear here. They mount
// only on the paired gateway pod (ADR-027 + ADR-038). The agent container
// itself sees no Secret bytes.
//
// Forks deliberately do NOT receive `PLATFORM_POD_FILES_EVENTS_URL`, so the
// agent-runtime running in the fork pod skips the pod-files SSE loop
// entirely. Forks are short-lived ACP-relay jobs spawned per turn; the
// SSE overhead per pod isn't justified for that lifecycle.
func BuildForkAgentJob(
	forkName string,
	forkSpec *types.ForkSpec,
	instanceSpec *types.InstanceSpec,
	agentSpec *types.AgentSpec,
	cfg *config.Config,
	ownerCM *corev1.ConfigMap,
	credentialSecrets []corev1.Secret,
) *batchv1.Job {
	labels := map[string]string{
		ForkLabelType:   ForkJobLabelType,
		ForkLabelForkID: forkName,
		// `agent-platform.ai/instance` references the *parent* instance for
		// fork pods — the pod-IP resolver and ext_authz identity flow
		// through that label, so traffic from the fork resolves under the
		// parent's egress rules (ADR-027).
		ForkLabelInstanceRef: forkSpec.Instance,
		// Pair key + role for ADR-038 NetworkPolicy / Service scoping.
		// Using the fork name as the pair key isolates the fork from the
		// parent instance pair: fork agent only reaches fork gateway,
		// never the parent's gateway.
		LabelPair: forkName,
		LabelRole: RoleAgent,
	}

	caCertPath := "/etc/platform/ca/ca.crt"

	// Paired gateway Service DNS — stable across the fork lifetime.
	proxyAddr := fmt.Sprintf("http://%s:%d", GatewayName(forkName), cfg.EnvoyPort)

	env := []corev1.EnvVar{
		{Name: "HTTPS_PROXY", Value: proxyAddr},
		{Name: "HTTP_PROXY", Value: proxyAddr},
		{Name: "https_proxy", Value: proxyAddr},
		{Name: "http_proxy", Value: proxyAddr},
		{Name: "SSL_CERT_FILE", Value: caCertPath},
		{Name: "NODE_EXTRA_CA_CERTS", Value: caCertPath},
		{Name: "GIT_SSL_CAINFO", Value: caCertPath},
		{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		{Name: "ADK_INSTANCE_ID", Value: forkSpec.Instance},
		{Name: "API_SERVER_URL", Value: cfg.APIServerURL()},
		{Name: "HOME", Value: cfg.AgentHome},
		{Name: "PLATFORM_MCP_URL", Value: fmt.Sprintf("%s/api/instances/%s/mcp", cfg.HarnessServerURL, forkSpec.Instance)},
		{Name: "PLATFORM_FORK_ID", Value: forkName},
		{Name: "PLATFORM_FOREIGN_SUB", Value: forkSpec.ForeignSub},
	}
	// Placeholder credential envs from the replier's K8s Secrets — same
	// purpose as the long-lived shape: satisfy the harness's is-env-set
	// check; the gateway's Envoy overwrites the header on the wire.
	env = append(env, credentialEnvVars(credentialSecrets)...)
	for _, e := range agentSpec.Env {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}
	for _, e := range instanceSpec.Env {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}

	var envFrom []corev1.EnvFromSource
	if instanceSpec.SecretRef != "" {
		envFrom = append(envFrom, corev1.EnvFromSource{
			SecretRef: &corev1.SecretEnvSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: instanceSpec.SecretRef},
			},
		})
	}

	var volumes []corev1.Volume
	var volumeMounts []corev1.VolumeMount

	for _, m := range agentSpec.Mounts {
		volName := types.SanitizeMountName(m.Path)
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name: volName, MountPath: m.Path,
		})
		if m.Persist {
			pvcName := fmt.Sprintf("%s-%s-0", volName, forkSpec.Instance)
			volumes = append(volumes, corev1.Volume{
				Name: volName,
				VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
						ClaimName: pvcName,
					},
				},
			})
		} else {
			volumes = append(volumes, corev1.Volume{
				Name:         volName,
				VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
			})
		}
	}

	// CA cert volume — projected from the per-fork cert-manager-issued leaf
	// Secret (single-key projection). The leaf private key (tls.key) lives
	// only on the paired gateway pod (ADR-038).
	if len(credentialSecrets) > 0 {
		volumes = append(volumes, corev1.Volume{
			Name: "ca-cert",
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: EnvoyLeafSecretName(forkName),
					Items:      []corev1.KeyToPath{{Key: "ca.crt", Path: "ca.crt"}},
				},
			},
		})
	} else {
		volumes = append(volumes, corev1.Volume{
			Name:         "ca-cert",
			VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
		})
	}
	volumeMounts = append(volumeMounts, corev1.VolumeMount{
		Name: "ca-cert", MountPath: "/etc/platform/ca", ReadOnly: true,
	})

	resourceReqs := corev1.ResourceRequirements{}
	if agentSpec.Resources.Requests != nil {
		resourceReqs.Requests = toResourceList(agentSpec.Resources.Requests)
	}
	if agentSpec.Resources.Limits != nil {
		resourceReqs.Limits = toResourceList(agentSpec.Resources.Limits)
	}

	// Init containers: optional user-defined init only.
	var initContainers []corev1.Container
	if agentSpec.Init != "" {
		initContainers = append(initContainers, corev1.Container{
			Name:            "init",
			Image:           agentSpec.Image,
			ImagePullPolicy: corev1.PullPolicy(cfg.AgentImagePullPolicy),
			Command:         []string{"sh", "-c", agentSpec.Init},
			VolumeMounts:    volumeMounts,
		})
	}

	var pullSecrets []corev1.LocalObjectReference
	for _, name := range cfg.AgentImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: name})
	}

	var podSec *corev1.PodSecurityContext
	if agentSpec.SecurityContext != nil {
		podSec = &corev1.PodSecurityContext{
			RunAsNonRoot: agentSpec.SecurityContext.RunAsNonRoot,
		}
	}

	// GH_TOKEN signal — mirrors the long-lived shape.
	ghAvail := "false"
	if hasGitHubCredential(credentialSecrets) {
		ghAvail = "true"
	}
	env = append(env, corev1.EnvVar{Name: "PLATFORM_GH_TOKEN_AVAILABLE", Value: ghAvail})

	containers := []corev1.Container{{
		Name:            "agent",
		Image:           agentSpec.Image,
		ImagePullPolicy: corev1.PullPolicy(cfg.AgentImagePullPolicy),
		Ports: []corev1.ContainerPort{{
			Name: "acp", ContainerPort: 8080,
		}},
		Env:     env,
		EnvFrom: envFrom,
		ReadinessProbe: &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 1,
		},
		LivenessProbe: &corev1.Probe{
			ProbeHandler:        corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			InitialDelaySeconds: 10,
			PeriodSeconds:       10,
		},
		SecurityContext: &corev1.SecurityContext{
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
			},
		},
		Resources:    resourceReqs,
		VolumeMounts: volumeMounts,
	}}

	falseVal := false
	automountSAToken := &falseVal
	shareProcessNS := &falseVal

	ttl := int32(60)
	backoff := int32(0)

	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      forkName,
			Namespace: cfg.Namespace,
			Labels:    labels,
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					// ADR-041 + ADR-027: fork agent runs as the per-fork SA
					// (its own identity, NOT the parent's). The per-fork
					// harness AuthorizationPolicy admits this SA only to
					// `/api/instances/<parent>/mcp` — narrower than the
					// parent's surface, so a compromised fork (i.e. a
					// compromised replier) cannot reach pod-files SSE,
					// `/internal/trigger`, or any other parent-scoped
					// harness endpoint.
					ServiceAccountName:            forkName,
					RestartPolicy:                 corev1.RestartPolicyNever,
					TerminationGracePeriodSeconds: &cfg.TerminationGracePeriod,
					ImagePullSecrets:              pullSecrets,
					SecurityContext:               podSec,
					InitContainers:                initContainers,
					AutomountServiceAccountToken:  automountSAToken,
					ShareProcessNamespace:         shareProcessNS,
					Containers:                    containers,
					Volumes:                       volumes,
				},
			},
		},
	}
}
