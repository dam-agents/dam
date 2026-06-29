package reconciler

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// createPodIfMissing creates desired only if no pod of that name exists. Bare
// ephemeral pods are immutable in their key fields, so an existing pod with the
// same name is authoritative and left running. Owner references GC it with its
// owner. Shared by the Fork and Run reconcilers.
func createPodIfMissing(ctx context.Context, client kubernetes.Interface, desired *corev1.Pod) error {
	_, err := client.CoreV1().Pods(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = client.CoreV1().Pods(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
	}
	return err
}

// findEphemeralPod returns the live (non-terminating) pod labeled labelKey=name,
// or nil if none. Shared by the Fork and Run reconcilers.
func findEphemeralPod(ctx context.Context, client kubernetes.Interface, namespace, labelKey, name string) (*corev1.Pod, error) {
	pods, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("%s=%s", labelKey, name),
	})
	if err != nil {
		return nil, err
	}
	for i := range pods.Items {
		if pods.Items[i].DeletionTimestamp == nil {
			return &pods.Items[i], nil
		}
	}
	return nil, nil
}

// resolveParentWorkspacePVCs maps each persisted mount of the parent Agent to
// the PVC name backing it, looked up by (agent, mount) label so a warm-pool
// workspace — whose name is the pool's generated name, not the
// `<mount>-<agent>-0` convention — resolves correctly (#692). For agents created
// before the mount label existed, no labeled PVC is found and it falls back to
// the legacy convention name, which is still the real name for those. Shared by
// the Fork and Run reconcilers.
func resolveParentWorkspacePVCs(ctx context.Context, client kubernetes.Interface, cfg *config.Config, parentAgent string, agentSpec *types.AgentSpec) (map[string]string, error) {
	out := map[string]string{}
	for _, m := range resolveSpecMounts(agentSpec, cfg.AgentTemplateDefaults) {
		if !m.Persist {
			continue
		}
		volName := types.SanitizeMountName(m.Path)
		list, err := client.CoreV1().PersistentVolumeClaims(cfg.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: LabelAgent + "=" + parentAgent + "," + LabelMount + "=" + volName,
		})
		if err != nil {
			return nil, err
		}
		if len(list.Items) > 0 {
			out[volName] = list.Items[0].Name
		} else {
			out[volName] = fmt.Sprintf("%s-%s-0", volName, parentAgent)
		}
	}
	return out, nil
}

// rewriteParentPVCs overwrites the ephemeral pod's workspace-volume claim refs
// with the parent PVC names resolved by label (#692) — the builder fills in the
// legacy `<mount>-<agent>-0` name; this swaps in the warm-pool spare's generated
// name when the parent claimed one (a no-op for pre-label agents and an empty
// map). Shared by Fork (Job template) and Run (Pod) — both pass their volumes.
func rewriteParentPVCs(volumes []corev1.Volume, parentPVCs map[string]string) {
	for i := range volumes {
		pvc := volumes[i].PersistentVolumeClaim
		if pvc == nil {
			continue
		}
		if name, ok := parentPVCs[volumes[i].Name]; ok {
			pvc.ClaimName = name
		}
	}
}

// Shared shape for the two ephemeral pod-set kinds derived from an Agent: the
// per-turn Fork (wrapped in a Job) and the per-command Run executor (a bare
// Pod). Both run the agent image with egress through a paired gateway pod
// reached via HTTPS_PROXY, mount the parent's RWX workspace, and carry no
// SA token and no credential bytes — the gateway injects credentials on the
// wire. The only differences are the identity/type labels, a few env vars, and
// the workload kind, captured by ephemeralPodConfig.

type ephemeralPodConfig struct {
	name               string // fork/run name; pair key
	parentAgentID      string // parent Agent: PVC owner + ext-authz/MCP identity
	agentSpec          *types.AgentSpec
	cfg                *config.Config
	credentialSecrets  []corev1.Secret
	gatewayClusterIP   string
	serviceAccountName string          // SA the pod runs as ("" → namespace default)
	leafSecretName     string          // Envoy leaf Secret to project ca.crt from
	typeLabel          string          // value for ForkLabelType
	idLabelKey         string          // ForkLabelForkID / RunLabelRunID
	extraEnv           []corev1.EnvVar // kind-specific env (fork ids / exec-only)
}

// buildEphemeralAgentPod renders the object-level labels and the pod template
// shared by Fork Jobs and Run Pods. The template's pod labels add the
// ambient-mesh opt-out; the agent half is gated at the kernel by NetworkPolicy,
// not the mesh.
func buildEphemeralAgentPod(c ephemeralPodConfig) (objLabels map[string]string, tmpl corev1.PodTemplateSpec) {
	base := c.cfg.AgentBase
	defaults := c.cfg.AgentTemplateDefaults

	pullPolicy := c.agentSpec.ImagePullPolicy
	if pullPolicy == "" {
		pullPolicy = defaults.ImagePullPolicy
	}
	agentHome := c.agentSpec.AgentHome
	if agentHome == "" {
		agentHome = defaults.AgentHome
	}
	specMounts := resolveSpecMounts(c.agentSpec, defaults)
	// Project only chart-level platform defaults; user env rides the runtime channel, not spec.env.
	specEnv := configEnvToTypes(defaults.Env)

	objLabels = map[string]string{
		ForkLabelType: c.typeLabel,
		c.idLabelKey:  c.name,
		// `agent-platform.ai/agent` references the *parent* agent — the
		// pod-IP resolver and ext_authz identity flow through this label, so
		// traffic resolves under the parent's egress rules.
		ForkLabelAgentRef: c.parentAgentID,
		// Pair key + role for NetworkPolicy / Service scoping. Using the
		// ephemeral name as the pair key isolates it from the parent agent's
		// pair: this agent only reaches its own gateway, never the parent's.
		LabelPair: c.name,
		LabelRole: RoleAgent,
	}
	podLabels := map[string]string{}
	for k, v := range objLabels {
		podLabels[k] = v
	}
	podLabels["istio.io/dataplane-mode"] = "none"

	// Paired gateway's ClusterIP literal — IP-direct so HTTPS_PROXY has zero
	// DNS dependency. The reconciler requeues until the gateway Service has a
	// ClusterIP, so the IP is always known by the time we get here.
	proxyAddr := fmt.Sprintf("http://%s:%d", c.gatewayClusterIP, c.cfg.EnvoyPort)

	env := []corev1.EnvVar{
		{Name: "HTTPS_PROXY", Value: proxyAddr},
		{Name: "HTTP_PROXY", Value: proxyAddr},
		{Name: "https_proxy", Value: proxyAddr},
		{Name: "http_proxy", Value: proxyAddr},
		{Name: "NODE_EXTRA_CA_CERTS", Value: "/etc/platform/ca/ca.crt"},
		{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		{Name: "PLATFORM_AGENT_ID", Value: c.parentAgentID},
		{Name: "API_SERVER_URL", Value: c.cfg.APIServerURL()},
		{Name: "HOME", Value: agentHome},
		{Name: "PLATFORM_MCP_URL", Value: fmt.Sprintf("%s/api/agents/%s/mcp", c.cfg.HarnessServerURL, c.parentAgentID)},
	}
	env = append(env, c.extraEnv...)
	// Placeholder credential envs from the K8s Secrets — same purpose as the
	// long-lived shape: satisfy the harness's is-env-set check; the gateway's
	// Envoy overwrites the header on the wire.
	env = append(env, credentialEnvVars(c.credentialSecrets)...)
	for _, e := range specEnv {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}

	var envFrom []corev1.EnvFromSource
	if c.agentSpec.SecretRef != "" {
		envFrom = append(envFrom, corev1.EnvFromSource{
			SecretRef: &corev1.SecretEnvSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: c.agentSpec.SecretRef},
			},
		})
	}

	var volumes []corev1.Volume
	var volumeMounts []corev1.VolumeMount
	for _, m := range specMounts {
		volName := types.SanitizeMountName(m.Path)
		volumeMounts = append(volumeMounts, corev1.VolumeMount{Name: volName, MountPath: m.Path})
		if m.Persist {
			pvcName := fmt.Sprintf("%s-%s-0", volName, c.parentAgentID)
			volumes = append(volumes, corev1.Volume{
				Name: volName,
				VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pvcName},
				},
			})
		} else {
			volumes = append(volumes, corev1.Volume{
				Name:         volName,
				VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
			})
		}
	}

	// CA cert volume — projected from the per-instance cert-manager-issued leaf
	// Secret (single-key projection). The leaf private key (tls.key) lives only
	// on the paired gateway pod.
	if len(c.credentialSecrets) > 0 {
		volumes = append(volumes, corev1.Volume{
			Name: "ca-cert",
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: EnvoyLeafSecretName(c.leafSecretName),
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
	if c.agentSpec.Resources.Requests != nil {
		resourceReqs.Requests = toResourceList(c.agentSpec.Resources.Requests)
	}
	if c.agentSpec.Resources.Limits != nil {
		resourceReqs.Limits = toResourceList(c.agentSpec.Resources.Limits)
	}
	if resourceReqs.Requests == nil && resourceReqs.Limits == nil && defaults.Resources != nil {
		resourceReqs = *defaults.Resources
	}

	initScript := c.agentSpec.Init
	if initScript == "" {
		initScript = defaults.Init
	}
	var initContainers []corev1.Container
	if ic := buildIptablesInitContainer(c.cfg, c.gatewayClusterIP); ic != nil {
		initContainers = append(initContainers, *ic)
	}
	if ic := buildNPGateInitContainer(c.cfg, c.gatewayClusterIP); ic != nil {
		initContainers = append(initContainers, *ic)
	}
	if initScript != "" {
		initContainers = append(initContainers, corev1.Container{
			Name:            "init",
			Image:           c.agentSpec.Image,
			ImagePullPolicy: corev1.PullPolicy(pullPolicy),
			Command:         []string{"sh", "-c", initScript},
			Env:             []corev1.EnvVar{{Name: "HOME", Value: agentHome}},
			VolumeMounts:    volumeMounts,
		})
	}

	var pullSecrets []corev1.LocalObjectReference
	if c.agentSpec.ImagePullSecretRef != "" {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: c.agentSpec.ImagePullSecretRef})
	}
	for _, n := range base.ImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: n})
	}

	var readinessProbe, livenessProbe *corev1.Probe
	if c.cfg.AgentProbesEnabled {
		readinessProbe = &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 1,
		}
		livenessProbe = &corev1.Probe{
			ProbeHandler:        corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			InitialDelaySeconds: 10,
			PeriodSeconds:       10,
			TimeoutSeconds:      5,
			FailureThreshold:    3,
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
		Image:           c.agentSpec.Image,
		ImagePullPolicy: corev1.PullPolicy(pullPolicy),
		Ports:           []corev1.ContainerPort{{Name: "acp", ContainerPort: 8080}},
		Env:             env,
		EnvFrom:         envFrom,
		ReadinessProbe:  readinessProbe,
		LivenessProbe:   livenessProbe,
		SecurityContext: base.ContainerSecurityContext,
		Resources:       resourceReqs,
		VolumeMounts:    volumeMounts,
	}}

	podMeta := metav1.ObjectMeta{Labels: podLabels}
	applyAgentBaseMeta(&podMeta, base)

	podSpec := corev1.PodSpec{
		ServiceAccountName:            c.serviceAccountName,
		RestartPolicy:                 corev1.RestartPolicyNever,
		TerminationGracePeriodSeconds: &base.TerminationGracePeriod,
		ImagePullSecrets:              pullSecrets,
		SecurityContext:               base.PodSecurityContext,
		InitContainers:                initContainers,
		AutomountServiceAccountToken:  ptrBool(false),
		ShareProcessNamespace:         ptrBool(false),
		Containers:                    containers,
		Volumes:                       volumes,
	}
	applyAgentBaseScheduling(&podSpec, base)

	return objLabels, corev1.PodTemplateSpec{ObjectMeta: podMeta, Spec: podSpec}
}
