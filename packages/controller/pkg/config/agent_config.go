package config

import (
	"encoding/json"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
)

// Duration wraps time.Duration with JSON support — values.yaml ships
// human-readable strings like "1h" / "30m" through `toJson`, and the
// controller parses them on startup via time.ParseDuration. Zero value
// is allowed (commonly used to disable a timer; see IdleTimeout).
type Duration time.Duration

func (d Duration) AsDuration() time.Duration { return time.Duration(d) }

func (d *Duration) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("Duration: expected duration string, got %s", data)
	}
	parsed, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("Duration: %w", err)
	}
	*d = Duration(parsed)
	return nil
}

func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Duration(d).String())
}

// AgentBase is the chart-only platform policy applied verbatim to every
// controller-rendered agent / fork agent pod. Agent ConfigMaps cannot
// override these fields by design — security, scheduling, and cluster
// integration are operator policy. Shipped via the AGENT_BASE env var.
//
// Gateway pods are platform-managed and don't read this config; their
// scheduling and security are controller-internal.
//
// On metadata collision: controller-managed labels on agent pods (selector
// labels `agent-platform.ai/agent|pair|role`) and annotations the controller
// sets itself always win. ExtraLabels/ExtraAnnotations entries with the same
// key drop silently — see applyAgentBaseMeta.
type AgentBase struct {
	// Cluster details
	ImagePullSecrets []string `json:"imagePullSecrets,omitempty"`
	StorageClass     string   `json:"storageClass,omitempty"`
	AccessMode       string   `json:"accessMode,omitempty"` // ReadWriteMany (default) or ReadWriteOnce

	// Lifecycle
	IdleTimeout            Duration `json:"idleTimeout,omitempty"`            // hibernate idle instances; 0 disables.
	TerminationGracePeriod int64    `json:"terminationGracePeriod,omitempty"` // agent + fork agent only.

	// Pod metadata
	ExtraLabels      map[string]string `json:"extraLabels,omitempty"`
	ExtraAnnotations map[string]string `json:"extraAnnotations,omitempty"`

	// Scheduling
	NodeSelector              map[string]string                 `json:"nodeSelector,omitempty"`
	Tolerations               []corev1.Toleration               `json:"tolerations,omitempty"`
	Affinity                  *corev1.Affinity                  `json:"affinity,omitempty"`
	TopologySpreadConstraints []corev1.TopologySpreadConstraint `json:"topologySpreadConstraints,omitempty"`
	PriorityClassName         string                            `json:"priorityClassName,omitempty"`
	RuntimeClassName          string                            `json:"runtimeClassName,omitempty"`

	// Probes — per-probe overrides; the master switch is Config.AgentProbesEnabled.
	Probes *AgentProbes `json:"probes,omitempty"`

	// Security — chart-only floor. The agent ConfigMap cannot set these.
	PodSecurityContext       *corev1.PodSecurityContext `json:"podSecurityContext,omitempty"`
	ContainerSecurityContext *corev1.SecurityContext    `json:"containerSecurityContext,omitempty"`

	// IptablesInit configures the privileged init container that pins the
	// agent pod's OUTPUT chain to the paired gateway (kernel-level
	// defense-in-depth on top of the NetworkPolicy).
	IptablesInit *AgentIptablesInit `json:"iptablesInit,omitempty"`

	// NPGateInit configures an unprivileged init container that gates the
	// agent's main container on egress NetworkPolicy being verifiably
	// enforced. Used where IptablesInit can't run.
	NPGateInit *AgentNPGateInit `json:"npGateInit,omitempty"`
}

type AgentIptablesInit struct {
	Enabled bool   `json:"enabled,omitempty"`
	Image   string `json:"image,omitempty"`
}

type AgentNPGateInit struct {
	Enabled bool   `json:"enabled,omitempty"`
	Image   string `json:"image,omitempty"`
	// Bound on probe convergence; fail-closed on timeout.
	TimeoutSeconds int `json:"timeoutSeconds,omitempty"`
}

// AgentProbes — sub-field nil means "use the controller's built-in probe
// for this pod kind" (HTTP GET /healthz on `acp`, see resources.go). A
// non-nil sub-field replaces that probe. The `probes.enabled` master
// switch (AgentProbesEnabled in Config) still gates whether any probes
// render at all.
type AgentProbes struct {
	Startup   *corev1.Probe `json:"startup,omitempty"`
	Readiness *corev1.Probe `json:"readiness,omitempty"`
	Liveness  *corev1.Probe `json:"liveness,omitempty"`
}

// AgentTemplateDefaults is the chart-wide fallback applied at reconcile
// time when an agent template (or bare-image AgentSpec) omits a field.
// Shipped via the AGENT_TEMPLATE_DEFAULTS env var.
//
// Semantics are per-field "template wins if set, else this value":
//   - Scalars (ImagePullPolicy, StorageSize, AgentHome): empty = fall back.
//   - Slices (Mounts, Env, SkillSources): empty = fall back (REPLACE, not
//     additive — a template that sets the field owns the whole list).
//   - Resources: empty (no requests/limits set) = fall back.
type AgentTemplateDefaults struct {
	// AgentHome is the HOME inside agent containers. The controller sets it
	// as the `HOME` env var and substitutes the literal string `$HOME` in
	// any AgentSpec mount path or skill-path. Must agree with the agent
	// image's user HOME or pod-files materialization breaks silently.
	// Plumbed to the api-server too — pod-files producers write to this path
	// on the shared volume.
	AgentHome string `json:"agentHome,omitempty"`

	ImagePullPolicy string                       `json:"imagePullPolicy,omitempty"`
	StorageSize     string                       `json:"storageSize,omitempty"`
	Resources       *corev1.ResourceRequirements `json:"resources,omitempty"`

	// Mounts, Env, SkillSources, Init are baked into the rendered pod when
	// the AgentSpec omits the corresponding field. Templates that need a
	// different shape REPLACE the whole value.
	Mounts       []Mount       `json:"mounts,omitempty"`
	Env          []EnvVar      `json:"env,omitempty"`
	SkillSources []SkillSource `json:"skillSources,omitempty"`
	// Init is a shell script run as the init container's entrypoint.
	// `$HOME` is shell-expanded at runtime — the controller sets the
	// HOME env var on the init container; do not pre-substitute here.
	Init string `json:"init,omitempty"`
}

// Mount mirrors types.Mount on the JSON side — defined here so config
// doesn't depend on the types package.
type Mount struct {
	Path    string `json:"path"`
	Persist bool   `json:"persist,omitempty"`
	Size    string `json:"size,omitempty"`
}

type EnvVar struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
}

type SkillSource struct {
	Name   string `json:"name"`
	GitURL string `json:"gitUrl"`
}
