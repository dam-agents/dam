package reconciler

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/kagenti/platform/packages/controller/pkg/config"
	"github.com/kagenti/platform/packages/controller/pkg/types"
)

// portInt32 narrows a config-supplied port (typed `int` because it comes
// from `strconv.Atoi` on an env var) to int32 with an explicit upper-bound
// check. Without the check, env-driven int → int32 conversion is flagged
// by CodeQL (`go/incorrect-integer-conversion`) and could wrap on 32-bit
// platforms; here it's a config-bootstrap invariant — port numbers are
// uint16 — so a panic is the right shape if the operator misconfigures.
func portInt32(p int) int32 {
	if p < 0 || p > 65535 {
		panic(fmt.Sprintf("port out of range: %d (must be 0..65535)", p))
	}
	return int32(p)
}

// Paired-pod labels. `LabelPair` identifies the two pods of a single
// agent/gateway pair; `LabelRole` distinguishes the roles inside the pair.
//
// Pair scope is *per orchestration unit*, not per agent: long-lived agents
// use the agent name as the pair key, but forks use the fork name (each
// fork has its own paired gateway, the parent's gateway is not shared).
// The `LabelAgent` label still identifies the parent agent for ext_authz /
// pod-IP resolver purposes — for long-lived pods it equals the pair key,
// for fork pods it points at the parent agent so traffic resolves under
// the parent's egress rules.
const (
	// LabelAgent points at the durable Agent ConfigMap. After Instance was
	// collapsed into Agent, this replaces the former
	// `agent-platform.ai/agent` label.
	LabelAgent  = "agent-platform.ai/agent"
	LabelPair   = "agent-platform.ai/pair"
	LabelRole   = "agent-platform.ai/role"
	RoleAgent   = "agent"
	RoleGateway = "gateway"

	// LabelMount records the sanitized mount a persisted workspace PVC backs. Set
	// on every persisted PVC (volumeClaimTemplate and claimed spare), so a PVC is
	// addressed by (LabelAgent, LabelMount) rather than a reconstructed
	// `<mount>-<agent>-0` name — a claimed spare keeps its generated name (#692).
	LabelMount = "agent-platform.ai/mount"

	// Warm-pool labels (#692). A spare carries LabelPool (canonical size = pool
	// key) and, while unclaimed, LabelPoolAvailable="true" but NO LabelAgent — so
	// the orphan sweep (lists by LabelAgent) skips it. On claim it gains
	// LabelAgent + LabelMount and loses LabelPoolAvailable, becoming an ordinary
	// agent PVC.
	LabelPool          = "agent-platform.ai/pool"
	LabelPoolAvailable = "agent-platform.ai/pool-available"
)

// annRollRev is an api-server-set annotation on the Agent that requests a
// rolling restart of the pair. The controller stamps its value into
// both pod templates, so bumping it rolls the agent + gateway without any
// spec/status write — this is how the UI restart button and credential-grant
// changes force a fresh pod. It is complementary to the gateway's
// content-derived envoy-secrets-rev, which auto-rolls the gateway when the
// resolved Secret set changes.
const annRollRev = "agent-platform.ai/roll-rev"

// agentProxyAddr is the agent's HTTPS_PROXY value — IP-direct, no DNS.
// The agent/fork reconcilers requeue until the gateway ClusterIP is
// assigned, so this never sees an empty IP at steady state.
func agentProxyAddr(cfg *config.Config, gatewayClusterIP string) string {
	return fmt.Sprintf("http://%s:%d", gatewayClusterIP, cfg.EnvoyPort)
}

// BuildAgentStatefulSet renders the agent half of the paired pod set.
// The agent container holds zero credentials; egress credential
// injection happens in the paired gateway pod, reached via HTTPS_PROXY.
//
// The template is independent of the granted set: it always mounts the leaf
// Secret's `ca.crt` (the cluster MITM CA), and that leaf is always issued, so
// a grant change never alters the agent pod and never rolls it.
//
// `gatewayClusterIP` is the paired gateway Service's assigned ClusterIP,
// used directly as the HTTPS_PROXY target. The caller requeues when
// it's not yet assigned.
//
// There is no separate InstanceSpec anymore — the merged AgentSpec
// carries `SecretRef` and the single user-owned env list.
//
// Replicas are set to 1 here (the running default) but are owned by the
// reconciler's applyStatefulSet, which scales up on activity and defers
// scale-down to the idle checker (run state is activity-driven, not a
// stored desiredState).
func BuildAgentStatefulSet(name string, agentSpec *types.AgentSpec, cfg *config.Config, ownerRef metav1.OwnerReference, gatewayClusterIP string) *appsv1.StatefulSet {
	base := cfg.AgentBase
	defaults := cfg.AgentTemplateDefaults

	// Layer B fallbacks — template wins when set, else chart-wide default.
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

	replicas := int32(1)

	labels := map[string]string{
		LabelAgent: name,
		LabelPair:  name,
		LabelRole:  RoleAgent,
	}
	// Agent pods are deliberately NOT mesh participants. In ambient mode,
	// istio-cni iptables rewrites every outbound to ztunnel:15008 before
	// the kernel NetworkPolicy filter sees the real destination, so a
	// destination-pinned NP cannot enforce "agent → paired gateway only" —
	// it admits any HBONE-bound packet, i.e. any in-mesh destination.
	// Opting the agent out at the pod level removes the ztunnel redirect;
	// the per-pair `<id>-agent-egress` NetworkPolicy then sees real
	// destination IPs and gates them at L3/L4. The agent has no SPIFFE
	// identity in this model; mesh-keyed AuthorizationPolicy on the gateway
	// pod is gone (NP is the gate). The paired gateway pod remains a mesh
	// participant — its SPIFFE principal still gates gateway → harness and
	// gateway → ext-authz hops.
	podLabels := map[string]string{}
	for k, v := range labels {
		podLabels[k] = v
	}
	podLabels["istio.io/dataplane-mode"] = "none"

	caCertPath := "/etc/platform/ca/ca.crt"

	proxyAddr := agentProxyAddr(cfg, gatewayClusterIP)

	// The agent container holds zero platform credentials. Inbound calls to
	// agent-runtime's tRPC are gated by the api-server's mesh
	// AuthorizationPolicies; ALL outbound calls — external hosts AND the
	// harness API — cross the paired gateway pod.
	//
	// Identity for harness traffic comes from the gateway pod's
	// SPIFFE principal (gateway runs as the per-instance SA). When the
	// gateway's Envoy forwards to the harness Service, ztunnel encapsulates
	// the connection with the gateway's principal, and the waypoint
	// enforces principal == URL `:id`. The Envoy bootstrap routes
	// harness traffic without ext_authz HITL gating and without
	// credential-header injection.
	env := []corev1.EnvVar{
		{Name: "HTTPS_PROXY", Value: proxyAddr},
		{Name: "HTTP_PROXY", Value: proxyAddr},
		{Name: "https_proxy", Value: proxyAddr},
		{Name: "http_proxy", Value: proxyAddr},
		// Node doesn't read the system trust store, so it gets the cluster CA
		// through NODE_EXTRA_CA_CERTS (which adds to its built-in CAs). Other
		// tools (git, curl, Go, Python) read the system store, where the agent
		// entrypoint installs the CA — so we don't set SSL_CERT_FILE /
		// GIT_SSL_CAINFO, which would replace and drop the public CAs.
		{Name: "NODE_EXTRA_CA_CERTS", Value: caCertPath},
		{Name: "NODE_USE_ENV_PROXY", Value: "1"},
		{Name: "GIT_HTTP_PROXY_AUTHMETHOD", Value: "basic"},
		{Name: "PLATFORM_AGENT_ID", Value: name},
		{Name: "API_SERVER_URL", Value: cfg.APIServerURL()},
		{Name: "HOME", Value: agentHome},
		{Name: "PLATFORM_MCP_URL", Value: fmt.Sprintf("%s/api/agents/%s/mcp", cfg.HarnessServerURL, name)},
		// agent-runtime opens this SSE stream and materializes pod-files
		// (gh hosts.yml today; more producers later) directly under HOME.
		// Forks deliberately do NOT receive this env — see fork_resources.go.
		{Name: "PLATFORM_POD_FILES_EVENTS_URL", Value: fmt.Sprintf("%s/api/agents/%s/pod-files/events", cfg.HarnessServerURL, name)},
	}

	// User-supplied agent env; credential placeholders arrive via the runtime channel.
	for _, e := range specEnv {
		env = append(env, corev1.EnvVar{Name: e.Name, Value: e.Value})
	}

	// EnvFrom secretRef
	var envFrom []corev1.EnvFromSource
	if agentSpec.SecretRef != "" {
		envFrom = append(envFrom, corev1.EnvFromSource{
			SecretRef: &corev1.SecretEnvSource{
				LocalObjectReference: corev1.LocalObjectReference{Name: agentSpec.SecretRef},
			},
		})
	}

	// Volumes + mounts + PVC templates
	var volumes []corev1.Volume
	var volumeMounts []corev1.VolumeMount
	var pvcs []corev1.PersistentVolumeClaim

	for _, m := range specMounts {
		volName := types.SanitizeMountName(m.Path)
		volumeMounts = append(volumeMounts, corev1.VolumeMount{
			Name: volName, MountPath: m.Path,
		})
		if m.Persist {
			storageSize := effectiveMountSize(m, agentSpec, defaults)
			pvcSpec := corev1.PersistentVolumeClaimSpec{
				AccessModes: []corev1.PersistentVolumeAccessMode{corev1.PersistentVolumeAccessMode(base.AccessMode)},
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse(storageSize)},
				},
			}
			if base.StorageClass != "" {
				sc := base.StorageClass
				pvcSpec.StorageClassName = &sc
			}
			pvcs = append(pvcs, corev1.PersistentVolumeClaim{
				ObjectMeta: metav1.ObjectMeta{
					Name:   volName,
					Labels: map[string]string{LabelAgent: name, LabelMount: volName},
				},
				Spec: pvcSpec,
			})
		} else {
			volumes = append(volumes, corev1.Volume{
				Name:         volName,
				VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}},
			})
		}
	}

	// ca.crt only (the tls.key stays on the gateway) — the only platform data
	// the agent mounts. The leaf is always issued, so this Secret
	// always exists and the volume never flips with the granted set.
	volumes = append(volumes, corev1.Volume{
		Name: "ca-cert",
		VolumeSource: corev1.VolumeSource{
			Secret: &corev1.SecretVolumeSource{
				SecretName: EnvoyLeafSecretName(name),
				Items: []corev1.KeyToPath{{
					Key:  "ca.crt",
					Path: "ca.crt",
				}},
			},
		},
	})
	volumeMounts = append(volumeMounts, corev1.VolumeMount{
		Name: "ca-cert", MountPath: "/etc/platform/ca", ReadOnly: true,
	})

	// Resources: template wins when set, else chart-wide default.
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
	// Egress-lockdown runs before the user init so the allow-list is in
	// place by the time anything dials the network. Two flavors: the
	// kernel-level iptables init (works on plain OCI runtimes; needs
	// netfilter modules in the guest, which Kata/CoCo strips) and the
	// userspace NP-readiness gate (works everywhere — no caps, no
	// kernel modules; verifies the NetworkPolicy is in force before
	// releasing the workload). Whichever the chart enables fires here.
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
	if agentSpec.ImagePullSecretRef != "" {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: agentSpec.ImagePullSecretRef})
	}
	for _, n := range base.ImagePullSecrets {
		pullSecrets = append(pullSecrets, corev1.LocalObjectReference{Name: n})
	}

	// Startup + readiness hit /healthz every 1s so wake-up and ready
	// transitions surface near-instantly (readiness routing keys on PodReady).
	// Liveness stays 10s — it only needs to catch a hung process, not
	// drive routing. startup FailureThreshold=120 → ~2 min of runway,
	// enough for a cold pull of a large agent image.
	var startupProbe, readinessProbe, livenessProbe *corev1.Probe
	if cfg.AgentProbesEnabled {
		startupProbe = &corev1.Probe{
			ProbeHandler:     corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds:    1,
			FailureThreshold: 120,
		}
		readinessProbe = &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 1,
		}
		livenessProbe = &corev1.Probe{
			ProbeHandler:  corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/healthz", Port: intstr.FromString("acp")}},
			PeriodSeconds: 10,
		}
	}

	// Probes — chart-level Probes overrides (base.Probes) replace the
	// matching default per-field when the master switch is on.
	if base.Probes != nil {
		if base.Probes.Startup != nil && startupProbe != nil {
			startupProbe = base.Probes.Startup
		}
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
		StartupProbe:    startupProbe,
		ReadinessProbe:  readinessProbe,
		LivenessProbe:   livenessProbe,
		SecurityContext: base.ContainerSecurityContext,
		Resources:       resourceReqs,
		VolumeMounts:    volumeMounts,
	}}

	// Threat model: agent must have no SA token (Secret-read RBAC
	// would otherwise bypass the per-pod credential boundary). With the
	// paired-pod split the agent and gateway are different pods
	// so process-namespace sharing is structurally moot, but we keep
	// `false` explicit for clarity.
	falseVal := false
	automountSAToken := &falseVal
	shareProcessNS := &falseVal

	podMeta := metav1.ObjectMeta{
		Labels: podLabels,
	}
	applyAgentBaseMeta(&podMeta, base)

	podSpec := corev1.PodSpec{
		// Agent pod opts out of ambient mesh
		// (`istio.io/dataplane-mode: none` pod label above); it has no
		// SPIFFE workload identity. The per-instance SA still scopes
		// Secret access at the controller level —
		// `automountServiceAccountToken: false` keeps the SA token
		// off-pod (threat model).
		ServiceAccountName:            name,
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

	return &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       cfg.Namespace,
			Labels:          labels,
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:             &replicas,
			ServiceName:          name,
			Selector:             &metav1.LabelSelector{MatchLabels: labels},
			VolumeClaimTemplates: pvcs,
			Template: corev1.PodTemplateSpec{
				ObjectMeta: podMeta,
				Spec:       podSpec,
			},
		},
	}
}

// resolveSpecMounts returns the agent's effective mount list: the AgentSpec's
// own mounts, or the chart-wide default mounts when the spec omits them
// (REPLACE semantics, matching the env/skill fallback). Shared by the
// StatefulSet builder and the warm-pool claim path so the two never disagree
// about which volumes an agent has.
func resolveSpecMounts(agentSpec *types.AgentSpec, defaults config.AgentTemplateDefaults) []types.Mount {
	if len(agentSpec.Mounts) > 0 {
		return agentSpec.Mounts
	}
	return configMountsToTypes(defaults.Mounts)
}

// effectiveMountSize resolves a persisted mount's PVC size by the documented
// precedence: per-mount override > AgentSpec.StorageSize > chart default. All
// three are validated upstream (Config.Validate for the chart default,
// ParseAgentSpec for spec.yaml values). Shared with the warm-pool claim path
// so a mount is matched to a pool by the exact size the StatefulSet renders.
func effectiveMountSize(m types.Mount, agentSpec *types.AgentSpec, defaults config.AgentTemplateDefaults) string {
	if m.Size != "" {
		return m.Size
	}
	if agentSpec.StorageSize != "" {
		return agentSpec.StorageSize
	}
	return defaults.StorageSize
}

// applyPoolClaims swaps the named mounts from a volumeClaimTemplate to an
// explicit pod Volume referencing the claimed PVC by name (the shape forks use).
// The container's volumeMount already targets the mount name. No-op for an empty
// map, so unclaimed agents render exactly as before.
func applyPoolClaims(ss *appsv1.StatefulSet, claims map[string]string) {
	if len(claims) == 0 {
		return
	}
	kept := ss.Spec.VolumeClaimTemplates[:0]
	for _, vct := range ss.Spec.VolumeClaimTemplates {
		if _, claimed := claims[vct.Name]; claimed {
			continue
		}
		kept = append(kept, vct)
	}
	ss.Spec.VolumeClaimTemplates = kept
	for mountName, pvcName := range claims {
		ss.Spec.Template.Spec.Volumes = append(ss.Spec.Template.Spec.Volumes, corev1.Volume{
			Name: mountName,
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pvcName},
			},
		})
	}
}

// BuildAgentService is the headless Service the api-server uses to reach the
// agent pod's ACP/tRPC port. Selector pins to the pair key + role=agent so
// the gateway pod (which carries the same instance label) is excluded.
func BuildAgentService(name string, cfg *config.Config, ownerRef metav1.OwnerReference) *corev1.Service {
	selector := map[string]string{LabelPair: name, LabelRole: RoleAgent}
	return &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       cfg.Namespace,
			Labels:          map[string]string{LabelAgent: name, LabelPair: name, LabelRole: RoleAgent},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: corev1.ServiceSpec{
			ClusterIP: corev1.ClusterIPNone,
			Selector:  selector,
			Ports: []corev1.ServicePort{{
				Name: "acp", Port: 8080, TargetPort: intstr.FromString("acp"),
			}},
		},
	}
}

func toResourceList(m map[string]string) corev1.ResourceList {
	rl := make(corev1.ResourceList)
	for k, v := range m {
		rl[corev1.ResourceName(k)] = resource.MustParse(v)
	}
	return rl
}
