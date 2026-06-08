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
	ForkJobLabelType  = "agent-fork-job"
	ForkLabelForkID   = "agent-platform.ai/fork-id"
	ForkLabelAgentRef = "agent-platform.ai/agent"
	ForkLabelType     = "agent-platform.ai/type"
)

// applyForkParentPVCs rewrites the fork Job's workspace-volume claim refs to the
// parent PVC names the reconciler resolved by label (#692). BuildForkAgentJob
// fills in the legacy `<mount>-<agent>-0` name; this overwrites it with the
// resolved name, which is the warm-pool spare's generated name when the parent
// claimed one — and equals the legacy name for pre-label agents, making this a
// no-op there. No-op for an empty map.
func applyForkParentPVCs(job *batchv1.Job, parentPVCs map[string]string) {
	if len(parentPVCs) == 0 {
		return
	}
	vols := job.Spec.Template.Spec.Volumes
	for i := range vols {
		pvc := vols[i].PersistentVolumeClaim
		if pvc == nil {
			continue
		}
		if name, ok := parentPVCs[vols[i].Name]; ok {
			pvc.ClaimName = name
		}
	}
}

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
	agentSpec *types.AgentSpec,
	cfg *config.Config,
	ownerRef metav1.OwnerReference,
	credentialSecrets []corev1.Secret,
	gatewayClusterIP string,
) *batchv1.Job {
	base := cfg.AgentBase
	defaults := cfg.AgentTemplateDefaults

	pullPolicy := agentSpec.ImagePullPolicy
	if pullPolicy == "" {
		pullPolicy = defaults.ImagePullPolicy
	}
	agentHome := agentSpec.AgentHome
	if agentHome == "" {
		agentHome = defaults.AgentHome
	}
	specMounts := resolveSpecMounts(agentSpec, defaults)
	specEnv := agentSpec.Env
	if len(specEnv) == 0 {
		specEnv = configEnvToTypes(defaults.Env)
	}

	labels := map[string]string{
		ForkLabelType:   ForkJobLabelType,
		ForkLabelForkID: forkName,
		// `agent-platform.ai/agent` references the *parent* agent for
		// fork pods — the pod-IP resolver and ext_authz identity flow
		// through that label, so traffic from the fork resolves under the
		// parent's egress rules (ADR-027).
		ForkLabelAgentRef: forkSpec.AgentName,
		// Pair key + role for ADR-038 NetworkPolicy / Service scoping.
		// Using the fork name as the pair key isolates the fork from the
		// parent agent's pair: fork agent only reaches fork gateway,
		// never the parent's gateway.
		LabelPair: forkName,
		LabelRole: RoleAgent,
	}
	// Fork agent opts out of ambient mesh, mirroring the long-lived agent
	// shape. NetworkPolicy at the kernel is the boundary; the fork gateway
	// pod remains a mesh participant for SPIFFE-keyed harness + ext-authz
	// admission via the per-fork AuthorizationPolicies (ADR-041, ADR-027).
	podLabels := map[string]string{}
	for k, v := range labels {
		podLabels[k] = v
	}
	podLabels["istio.io/dataplane-mode"] = "none"

	caCertPath := "/etc/platform/ca/ca.crt"

	// Paired gateway's ClusterIP literal — IP-direct so HTTPS_PROXY has
	// zero DNS dependency. The fork reconciler requeues until the gateway
	// Service has been assigned a ClusterIP (see fork.go), so the IP is
	// always known by the time we get here.
	proxyAddr := fmt.Sprintf("http://%s:%d", gatewayClusterIP, cfg.EnvoyPort)

	env := []corev1.EnvVar{
		{Name: "HTTPS_PROXY", Value: proxyAddr},
		{Name: "HTTP_PROXY", Value: proxyAddr},
		{Name: "https_proxy", Value: proxyAddr},
		{Name: "http_proxy", Value: proxyAddr},
		// SSL_CERT_FILE / GIT_SSL_CAINFO left unset — see resources.go.
		{Name: "NODE_EXTRA_CA_CERTS", Value: caCertPath},
		{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		{Name: "PLATFORM_AGENT_ID", Value: forkSpec.AgentName},
		{Name: "API_SERVER_URL", Value: cfg.APIServerURL()},
		{Name: "HOME", Value: agentHome},
		{Name: "PLATFORM_MCP_URL", Value: fmt.Sprintf("%s/api/agents/%s/mcp", cfg.HarnessServerURL, forkSpec.AgentName)},
		{Name: "PLATFORM_FORK_ID", Value: forkName},
		{Name: "PLATFORM_FOREIGN_SUB", Value: forkSpec.ForeignSub},
	}
	// Placeholder credential envs from the replier's K8s Secrets — same
	// purpose as the long-lived shape: satisfy the harness's is-env-set
	// check; the gateway's Envoy overwrites the header on the wire.
	// ADR-046: the merged AgentSpec carries the only user-owned env layer.
	env = append(env, credentialEnvVars(credentialSecrets)...)
	for _, e := range specEnv {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}

	var envFrom []corev1.EnvFromSource
	if agentSpec.SecretRef != "" {
		envFrom = append(envFrom, corev1.EnvFromSource{
			SecretRef: &corev1.SecretEnvSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: agentSpec.SecretRef},
			},
		})
	}

	var volumes []corev1.Volume
	var volumeMounts []corev1.VolumeMount

	for _, m := range specMounts {
		volName := types.SanitizeMountName(m.Path)
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name: volName, MountPath: m.Path,
		})
		if m.Persist {
			pvcName := fmt.Sprintf("%s-%s-0", volName, forkSpec.AgentName)
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
	if resourceReqs.Requests == nil && resourceReqs.Limits == nil && defaults.Resources != nil {
		resourceReqs = *defaults.Resources
	}

	// Init container: template wins, else chart-wide default.
	initScript := agentSpec.Init
	if initScript == "" {
		initScript = defaults.Init
	}
	var initContainers []corev1.Container
	if ic := buildIptablesInitContainer(cfg, gatewayClusterIP); ic != nil {
		initContainers = append(initContainers, *ic)
	}
	if ic := buildNPGateInitContainer(cfg, gatewayClusterIP); ic != nil {
		initContainers = append(initContainers, *ic)
	}
	if initScript != "" {
		initContainers = append(initContainers, corev1.Container{
			Name:            "init",
			Image:           agentSpec.Image,
			ImagePullPolicy: corev1.PullPolicy(pullPolicy),
			Command:         []string{"sh", "-c", initScript},
			Env:             []corev1.EnvVar{{Name: "HOME", Value: agentHome}},
			VolumeMounts:    volumeMounts,
		})
	}

	var pullSecrets []corev1.LocalObjectReference
	for _, n := range base.ImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: n})
	}

	// GH_TOKEN signal — mirrors the long-lived shape.
	ghAvail := "false"
	if hasGHTokenEnv(credentialSecrets) {
		ghAvail = "true"
	}
	env = append(env, corev1.EnvVar{Name: "PLATFORM_GH_TOKEN_AVAILABLE", Value: ghAvail})

	var readinessProbe, livenessProbe *corev1.Probe
	if cfg.AgentProbesEnabled {
		readinessProbe = &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 1,
		}
		livenessProbe = &corev1.Probe{
			ProbeHandler:        corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			InitialDelaySeconds: 10,
			PeriodSeconds:       10,
		}
	}
	if base.Probes != nil {
		if base.Probes.Readiness != nil && readinessProbe != nil {
			readinessProbe = base.Probes.Readiness
		}
		if base.Probes.Liveness != nil && livenessProbe != nil {
			livenessProbe = base.Probes.Liveness
		}
	}

	containers := []corev1.Container{{
		Name:            "agent",
		Image:           agentSpec.Image,
		ImagePullPolicy: corev1.PullPolicy(pullPolicy),
		Ports: []corev1.ContainerPort{{
			Name: "acp", ContainerPort: 8080,
		}},
		Env:             env,
		EnvFrom:         envFrom,
		ReadinessProbe:  readinessProbe,
		LivenessProbe:   livenessProbe,
		SecurityContext: base.ContainerSecurityContext,
		Resources:       resourceReqs,
		VolumeMounts:    volumeMounts,
	}}

	falseVal := false
	automountSAToken := &falseVal
	shareProcessNS := &falseVal

	ttl := int32(60)
	backoff := int32(0)

	podMeta := metav1.ObjectMeta{Labels: podLabels}
	applyAgentBaseMeta(&podMeta, base)

	podSpec := corev1.PodSpec{
		// Fork agent opts out of ambient (no SPIFFE on the agent
		// half). ADR-027: the per-fork SA still scopes credential
		// reads at the controller level — fork's gateway pod mounts
		// the replier's Secrets, never the parent's. Harness identity
		// flows through the fork *gateway*'s SPIFFE principal
		// (gateway is still in mesh), not the agent's; the per-fork
		// harness AuthorizationPolicy admits the fork SA only to
		// `/api/agents/<parent>/mcp`.
		ServiceAccountName:            forkName,
		RestartPolicy:                 corev1.RestartPolicyNever,
		TerminationGracePeriodSeconds: &base.TerminationGracePeriod,
		ImagePullSecrets:              pullSecrets,
		SecurityContext:               base.PodSecurityContext,
		InitContainers:                initContainers,
		AutomountServiceAccountToken:  automountSAToken,
		ShareProcessNamespace:         shareProcessNS,
		Containers:                    containers,
		Volumes:                       volumes,
	}
	applyAgentBaseScheduling(&podSpec, base)

	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:            forkName,
			Namespace:       cfg.Namespace,
			Labels:          labels,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: podMeta,
				Spec:       podSpec,
			},
		},
	}
}
