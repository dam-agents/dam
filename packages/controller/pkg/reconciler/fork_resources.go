package reconciler

import (
	"fmt"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/humr/packages/controller/pkg/config"
	"github.com/kagenti/humr/packages/controller/pkg/types"
)

const (
	ForkJobLabelType     = "agent-fork-job"
	ForkLabelForkID      = "humr.ai/fork-id"
	ForkLabelInstanceRef = "humr.ai/instance"
	ForkLabelType        = "humr.ai/type"
)

// BuildForkJob constructs the per-turn foreign-user fork pod.
//
// `credentialSecrets` are the replier's `(owner=foreignSub, connection=*)`
// K8s Secrets — the instance owner's Secrets must NOT appear here; the
// credential boundary is the container and the agent never sees Secret
// bytes. `HTTPS_PROXY` points at the colocated `envoy` sidecar on
// `127.0.0.1`; SA-token automount and process-namespace sharing are
// disabled.
//
// Forks deliberately do NOT receive `HUMR_POD_FILES_EVENTS_URL`, so the
// agent-runtime running in the fork pod skips the pod-files SSE loop
// entirely. Forks are short-lived ACP-relay jobs spawned per turn; the
// SSE overhead per pod isn't justified for that lifecycle, and most
// pod-files state (config, allowlists, host entries for connection-
// aware CLIs) is irrelevant to the relay flow. If a future fork-
// relevant feature ever needs files materialized in fork pods, set
// `HUMR_POD_FILES_EVENTS_URL` on the fork's env here — until then,
// pod-files state inside fork pods is unsupported on purpose.
func BuildForkJob(
	forkName string,
	forkSpec *types.ForkSpec,
	instanceSpec *types.InstanceSpec,
	agentSpec *types.AgentSpec,
	cfg *config.Config,
	ownerCM *corev1.ConfigMap,
	credentialSecrets []corev1.Secret,
) *batchv1.Job {
	labels := map[string]string{
		ForkLabelType:        ForkJobLabelType,
		ForkLabelForkID:      forkName,
		ForkLabelInstanceRef: forkSpec.Instance,
	}

	caCertPath := "/etc/humr/ca/ca.crt"

	proxyAddr := fmt.Sprintf("http://127.0.0.1:%d", cfg.EnvoyPort)

	env := []corev1.EnvVar{}
	env = append(env,
		corev1.EnvVar{Name: "HTTPS_PROXY", Value: proxyAddr},
		corev1.EnvVar{Name: "HTTP_PROXY", Value: proxyAddr},
		corev1.EnvVar{Name: "https_proxy", Value: proxyAddr},
		corev1.EnvVar{Name: "http_proxy", Value: proxyAddr},
		corev1.EnvVar{Name: "NO_PROXY", Value: cfg.APIServerHost},
		corev1.EnvVar{Name: "no_proxy", Value: cfg.APIServerHost},
		corev1.EnvVar{Name: "SSL_CERT_FILE", Value: caCertPath},
		corev1.EnvVar{Name: "NODE_EXTRA_CA_CERTS", Value: caCertPath},
		corev1.EnvVar{Name: "GIT_SSL_CAINFO", Value: caCertPath},
		corev1.EnvVar{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		corev1.EnvVar{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		corev1.EnvVar{Name: "ADK_INSTANCE_ID", Value: forkSpec.Instance},
		corev1.EnvVar{Name: "API_SERVER_URL", Value: cfg.APIServerURL()},
		corev1.EnvVar{Name: "HOME", Value: cfg.AgentHome},
		corev1.EnvVar{Name: "HUMR_MCP_URL", Value: fmt.Sprintf("%s/api/instances/%s/mcp", cfg.HarnessServerURL, forkSpec.Instance)},
		corev1.EnvVar{Name: "HUMR_FORK_ID", Value: forkName},
		corev1.EnvVar{Name: "HUMR_FOREIGN_SUB", Value: forkSpec.ForeignSub},
	)
	// Placeholder credential envs from the replier's K8s Secrets — same
	// purpose as the long-lived StatefulSet shape: satisfy the harness's
	// is-env-set check; Envoy overrides the header on the wire.
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
	// Secret. Mirrors `BuildStatefulSet`.
	if len(credentialSecrets) > 0 {
		volumes = append(volumes, corev1.Volume{
			Name: "ca-cert",
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: EnvoyLeafSecretName(forkName),
					Items: []corev1.KeyToPath{{Key: "ca.crt", Path: "ca.crt"}},
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
		Name: "ca-cert", MountPath: "/etc/humr/ca", ReadOnly: true,
	})

	resourceReqs := corev1.ResourceRequirements{}
	if agentSpec.Resources.Requests != nil {
		resourceReqs.Requests = toResourceList(agentSpec.Resources.Requests)
	}
	if agentSpec.Resources.Limits != nil {
		resourceReqs.Limits = toResourceList(agentSpec.Resources.Limits)
	}

	// Init containers: optional user-defined init only. The CA cert is
	// projected from the per-fork leaf Secret, so no fetch step is needed.
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

	// Sidecar only — agent container never sees credential mounts.
	volumes = append(volumes, envoySidecarVolumes(forkName, credentialSecrets)...)
	containers = append(containers, envoySidecarContainer(cfg, credentialSecrets))
	// ADR-033 Threat Model: agent must have no SA token (Secret-read RBAC
	// would otherwise bypass volume-mount scoping) and process namespace
	// must not be shared with the sidecar.
	falseVal := false
	automountSAToken := &falseVal
	shareProcessNS := &falseVal

	// GH_TOKEN signal — mirrors `BuildStatefulSet`. Surface whether a
	// GitHub credential is wired up so tooling doesn't have to make a
	// 401-eliciting request to find out.
	ghAvail := "false"
	if hasGitHubCredential(credentialSecrets) {
		ghAvail = "true"
	}
	containers[0].Env = append(containers[0].Env, corev1.EnvVar{
		Name:  "HUMR_GH_TOKEN_AVAILABLE",
		Value: ghAvail,
	})

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
