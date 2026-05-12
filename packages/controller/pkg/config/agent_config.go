package config

import (
	corev1 "k8s.io/api/core/v1"
)

// AgentConfig is the single, flat schema describing every operator-tunable
// aspect of controller-rendered pods — PVC sizing, image pull policy/secrets,
// pod metadata, scheduling, and agent-container additions. The chart writes
// the whole `controller.agent` block into AGENT_CONFIG (JSON) at deploy time.
//
// Designed to be partially overridden per-agent later: AgentConfig.Merge lets
// a per-agent AgentConfig (parsed from an agent ConfigMap) ride on top of the
// chart-level default. The merge isn't wired through the API yet, but the
// shape and rules are fixed so dropping it into AgentSpec is a one-line
// addition (`Config *AgentConfig` field + `cfg.AgentConfig.Merge(spec.Config)`).
//
// Scope boundaries the reconciler enforces — NOT enforced by this type:
//   - Pod metadata + scheduling fields apply to all four pod types (agent,
//     paired gateway, fork agent, fork gateway) so the paired pair stays
//     co-scheduled and shares runtime class.
//   - ExtraEnv/ExtraVolumes/ExtraVolumeMounts/Resources/Probes apply to the
//     agent container only — the gateway pod's Envoy bootstrap is
//     platform-managed and these knobs could silently break it.
//   - Controller-managed labels/annotations/env always win on collision:
//     selector labels (`agent-platform.ai/instance|pair|role`), the gateway's
//     `envoy-secrets-rev` annotation, and platform env (HTTPS_PROXY,
//     SSL_CERT_FILE, API_SERVER_URL, ...). The override drops silently.
type AgentConfig struct {
	// --- Pull / storage knobs ---
	ImagePullPolicy  string   `json:"imagePullPolicy,omitempty"`
	ImagePullSecrets []string `json:"imagePullSecrets,omitempty"`
	StorageClass     string   `json:"storageClass,omitempty"`
	AccessMode       string   `json:"accessMode,omitempty"` // ReadWriteMany (default) or ReadWriteOnce
	StorageSize      string   `json:"storageSize,omitempty"`

	// --- Pod metadata ---
	ExtraLabels      map[string]string `json:"extraLabels,omitempty"`
	ExtraAnnotations map[string]string `json:"extraAnnotations,omitempty"`

	// --- Scheduling ---
	NodeSelector              map[string]string                 `json:"nodeSelector,omitempty"`
	Tolerations               []corev1.Toleration               `json:"tolerations,omitempty"`
	Affinity                  *corev1.Affinity                  `json:"affinity,omitempty"`
	TopologySpreadConstraints []corev1.TopologySpreadConstraint `json:"topologySpreadConstraints,omitempty"`
	PriorityClassName         string                            `json:"priorityClassName,omitempty"`
	RuntimeClassName          string                            `json:"runtimeClassName,omitempty"`

	// --- Agent container additions (long-lived agent + fork agent) ---
	ExtraEnv          []corev1.EnvVar              `json:"extraEnv,omitempty"`
	ExtraVolumes      []corev1.Volume              `json:"extraVolumes,omitempty"`
	ExtraVolumeMounts []corev1.VolumeMount         `json:"extraVolumeMounts,omitempty"`
	Resources         *corev1.ResourceRequirements `json:"resources,omitempty"` // replaces agent template resources when set
	Probes            *AgentProbes                 `json:"probes,omitempty"`    // each sub-field replaces the matching default
}

// AgentProbes — sub-field nil means "keep the controller default". A non-nil
// sub-field replaces that probe. The `probes.enabled` master switch
// (AgentProbesEnabled in Config) still gates whether any probes render.
type AgentProbes struct {
	Startup   *corev1.Probe `json:"startup,omitempty"`
	Readiness *corev1.Probe `json:"readiness,omitempty"`
	Liveness  *corev1.Probe `json:"liveness,omitempty"`
}

// Merge returns a new AgentConfig combining the receiver (chart default) with
// `override` (per-agent). Rules:
//
//   - Scalars (ImagePullPolicy, StorageClass, …): override wins when non-empty.
//   - "Extra*" slices (ExtraEnv, ExtraVolumes, ExtraVolumeMounts, ImagePullSecrets):
//     append — additive by definition.
//   - "Extra*" maps (ExtraLabels, ExtraAnnotations): per-key merge, override wins.
//   - Whole-policy fields (NodeSelector, Tolerations, Affinity,
//     TopologySpreadConstraints, Resources): replace when non-empty/non-nil
//     — partial scheduling policies don't compose cleanly.
//   - Probes: per-probe replace (Startup/Readiness/Liveness) when non-nil.
//
// Receiver and override are not mutated. A nil receiver behaves as zero; a
// nil override returns a deep-enough copy of the receiver.
func (c *AgentConfig) Merge(override *AgentConfig) *AgentConfig {
	out := AgentConfig{}
	if c != nil {
		out = *c
	}
	if override == nil {
		return &out
	}

	// Scalars — override wins when non-empty.
	if override.ImagePullPolicy != "" {
		out.ImagePullPolicy = override.ImagePullPolicy
	}
	if override.StorageClass != "" {
		out.StorageClass = override.StorageClass
	}
	if override.AccessMode != "" {
		out.AccessMode = override.AccessMode
	}
	if override.StorageSize != "" {
		out.StorageSize = override.StorageSize
	}
	if override.PriorityClassName != "" {
		out.PriorityClassName = override.PriorityClassName
	}
	if override.RuntimeClassName != "" {
		out.RuntimeClassName = override.RuntimeClassName
	}

	// Extra* — additive.
	out.ImagePullSecrets = appendDistinct(out.ImagePullSecrets, override.ImagePullSecrets)
	out.ExtraEnv = append(append([]corev1.EnvVar{}, out.ExtraEnv...), override.ExtraEnv...)
	out.ExtraVolumes = append(append([]corev1.Volume{}, out.ExtraVolumes...), override.ExtraVolumes...)
	out.ExtraVolumeMounts = append(append([]corev1.VolumeMount{}, out.ExtraVolumeMounts...), override.ExtraVolumeMounts...)
	out.ExtraLabels = mergeStringMaps(out.ExtraLabels, override.ExtraLabels)
	out.ExtraAnnotations = mergeStringMaps(out.ExtraAnnotations, override.ExtraAnnotations)

	// Whole-policy fields — replace when non-empty/non-nil.
	if len(override.NodeSelector) > 0 {
		out.NodeSelector = override.NodeSelector
	}
	if len(override.Tolerations) > 0 {
		out.Tolerations = override.Tolerations
	}
	if override.Affinity != nil {
		out.Affinity = override.Affinity
	}
	if len(override.TopologySpreadConstraints) > 0 {
		out.TopologySpreadConstraints = override.TopologySpreadConstraints
	}
	if override.Resources != nil && (override.Resources.Requests != nil || override.Resources.Limits != nil) {
		out.Resources = override.Resources
	}

	// Probes — per-probe replace.
	if override.Probes != nil {
		if out.Probes == nil {
			out.Probes = &AgentProbes{}
		} else {
			p := *out.Probes
			out.Probes = &p
		}
		if override.Probes.Startup != nil {
			out.Probes.Startup = override.Probes.Startup
		}
		if override.Probes.Readiness != nil {
			out.Probes.Readiness = override.Probes.Readiness
		}
		if override.Probes.Liveness != nil {
			out.Probes.Liveness = override.Probes.Liveness
		}
	}

	return &out
}

func appendDistinct(base, extra []string) []string {
	if len(extra) == 0 {
		return base
	}
	seen := make(map[string]struct{}, len(base))
	for _, s := range base {
		seen[s] = struct{}{}
	}
	out := append([]string{}, base...)
	for _, s := range extra {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func mergeStringMaps(base, override map[string]string) map[string]string {
	if len(override) == 0 {
		return base
	}
	out := make(map[string]string, len(base)+len(override))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range override {
		out[k] = v
	}
	return out
}
