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
// controller-rendered agent / executor pod. Agent ConfigMaps cannot
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
	// StorageClass for workspace PVCs; empty = cluster default. Access mode
	// is not configurable: workspace volumes are always ReadWriteOnce — the
	// agent pod is the volume's only writer (#2988).
	StorageClass string `json:"storageClass,omitempty"`
	// Deprecated: ignored (#2988). Workspace volumes are always
	// ReadWriteOnce. Kept only so an install that still sets
	// controller.agent.base.accessMode in its values survives the strict
	// config decode on upgrade; LoadFromEnv warns when it is set.
	AccessMode string `json:"accessMode,omitempty"`

	// Lifecycle
	IdleTimeout            Duration `json:"idleTimeout,omitempty"`            // hibernate idle instances; 0 disables.
	TerminationGracePeriod int64    `json:"terminationGracePeriod,omitempty"` // agent + executor pod only.

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

// VMConfig configures the KubeVirt vm backend (spec.backend.type=vm).
// Chart-only, threaded via the AGENT_VM env var from Helm `virtualization.*`.
// Disabled ⇒ vm-backend agents fail reconcile with a clear error.
type VMConfig struct {
	Enabled bool `json:"enabled,omitempty"`
	// ScratchSize is the emptyDisk capacity attached to every VM (serial
	// "scratch") for the guest's docker/k3s image stores. Global knob by
	// design — not per-VM. Default 30Gi.
	ScratchSize string `json:"scratchSize,omitempty"`
	// Scheduling for virt-launcher pods (KVM-capable nodes). Applied instead
	// of AgentBase scheduling; the template's NodeSelector still merges on top.
	NodeSelector map[string]string   `json:"nodeSelector,omitempty"`
	Tolerations  []corev1.Toleration `json:"tolerations,omitempty"`
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

// WarmPool configures a background buffer of pre-provisioned, already-Bound
// spare workspace PVCs that a newly created agent claims instantly instead of
// waiting for dynamic provisioning (#692). Shipped via the WARM_POOL env var
// from `controller.warmPool`. Disabled by default — when off the controller
// behaves exactly as before.
type WarmPool struct {
	Enabled bool `json:"enabled,omitempty"`
	// StorageClass for spare PVCs. MUST be an Immediate-binding class
	// (volumeBindingMode: Immediate) so a spare provisions the instant it is
	// created and sits Bound and ready. Deliberately separate from
	// AgentBase.StorageClass, whose bundled NFS class is WaitForFirstConsumer —
	// under which a pre-created PVC would stay Pending and save nothing. The
	// access mode is NOT configured here: a claimed spare becomes the agent's
	// workspace PVC, so it is ReadWriteOnce like every workspace volume.
	StorageClass string `json:"storageClass,omitempty"`
	// ReplenishInterval is how often the manager reconciles inventory toward
	// target. Zero falls back to a built-in default.
	ReplenishInterval Duration `json:"replenishInterval,omitempty"`
	// MaxProvisioningTime bounds how long a spare may sit Pending (provisioning)
	// before the manager treats it as stuck and reclaims it. Must sit well above
	// the worst-case *healthy* provisioning time on the backing storage, or a
	// slow-but-healthy spare gets reaped and recreated in a churn loop. Zero
	// falls back to a generous built-in default.
	MaxProvisioningTime Duration `json:"maxProvisioningTime,omitempty"`
	// Sizes are the per-size buffers. Each {size, target} is an independent
	// pool keyed by the canonicalized size; an agent claims from the pool whose
	// size matches its effective workspace size.
	Sizes []WarmPoolSize `json:"sizes,omitempty"`
}

type WarmPoolSize struct {
	Size   string `json:"size"`   // K8s quantity, e.g. "10Gi"
	Target int    `json:"target"` // desired ready spares for this size
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
	Path   string `json:"path,omitempty"`
}

// StorageMigration drives the one-time RWX -> RWO workspace-volume migration
// (#2988). The controller copies every ReadWriteMany workspace PVC onto a
// fresh ReadWriteOnce volume (checksum-verified), re-points the agent's
// StatefulSet, and deletes the old volume — forcibly scaling the agent down
// for the duration of its copy. Shipped via the STORAGE_MIGRATION env var
// from `controller.storageMigration`. A no-op once no RWX workspace volume
// remains, so leaving it enabled on a fully-migrated install costs one PVC
// list per interval.
type StorageMigration struct {
	Enabled bool `json:"enabled,omitempty"`
	// Concurrency caps how many agents migrate at once (default 10). Each
	// migration reads its source volume in full three times (copy + two
	// verification passes), so the cap is what stands between a fleet
	// drain and saturating the shared filesystem being drained — lower it
	// if the filer's read throughput suffers, raise it if the fleet's
	// total drain time matters more.
	Concurrency int `json:"concurrency,omitempty"`
	// Interval between reconcile passes. Zero falls back to a built-in
	// default.
	Interval Duration `json:"interval,omitempty"`
	// AllowOwnershipRemap lets the copy proceed when the source workspace
	// holds entries owned by a uid other than the agent's. The copy is
	// unprivileged (chown is unavailable under a restricted SCC and on a
	// Kata sandbox's virtiofs), so those entries are recreated owned by the
	// agent uid — a deliberate normalization, not a faithful copy, which is
	// why it is opt-in. Default false: such entries are reported and block
	// the migration, so an operator decides rather than discovering the
	// remap later.
	AllowOwnershipRemap bool `json:"allowOwnershipRemap,omitempty"`
	// JobImage runs the copy script. It must provide a POSIX sh with GNU
	// coreutils (cp -a preserving hard links, find, md5sum) — busybox images
	// break hard-link-heavy workspaces (pnpm stores) by inflating them past
	// the volume size.
	JobImage string `json:"jobImage,omitempty"`
}
