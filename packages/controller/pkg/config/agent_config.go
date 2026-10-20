package config

import (
	"encoding/json"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
)

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

type AgentBase struct {
	ImagePullSecrets []string `json:"imagePullSecrets,omitempty"`
	StorageClass     string   `json:"storageClass,omitempty"`
	AccessMode       string   `json:"accessMode,omitempty"`

	IdleTimeout            Duration `json:"idleTimeout,omitempty"`
	VMIdleTimeout          Duration `json:"vmIdleTimeout,omitempty"`
	TerminationGracePeriod int64    `json:"terminationGracePeriod,omitempty"`

	ExtraLabels      map[string]string `json:"extraLabels,omitempty"`
	ExtraAnnotations map[string]string `json:"extraAnnotations,omitempty"`

	NodeSelector              map[string]string                 `json:"nodeSelector,omitempty"`
	Tolerations               []corev1.Toleration               `json:"tolerations,omitempty"`
	Affinity                  *corev1.Affinity                  `json:"affinity,omitempty"`
	TopologySpreadConstraints []corev1.TopologySpreadConstraint `json:"topologySpreadConstraints,omitempty"`
	PriorityClassName         string                            `json:"priorityClassName,omitempty"`
	RuntimeClassName          string                            `json:"runtimeClassName,omitempty"`

	Probes *AgentProbes `json:"probes,omitempty"`

	PodSecurityContext       *corev1.PodSecurityContext `json:"podSecurityContext,omitempty"`
	ContainerSecurityContext *corev1.SecurityContext    `json:"containerSecurityContext,omitempty"`

	IptablesInit *AgentIptablesInit `json:"iptablesInit,omitempty"`

	NPGateInit *AgentNPGateInit `json:"npGateInit,omitempty"`
}

type AgentIptablesInit struct {
	Enabled bool   `json:"enabled,omitempty"`
	Image   string `json:"image,omitempty"`
}

type AgentNPGateInit struct {
	Enabled        bool   `json:"enabled,omitempty"`
	Image          string `json:"image,omitempty"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty"`
}

type VMConfig struct {
	Enabled          bool               `json:"enabled,omitempty"`
	Runner           VMRunnerSpec       `json:"runner,omitempty"`
	RuntimeMigration VMRuntimeMigration `json:"runtimeMigration,omitempty"`
	Gateway          VMGateway          `json:"gateway,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: whether vm Agents egress through one gateway pod per owner instead of a gateway pod each. Off by default, so an install switches to it on purpose and can switch back.
type VMGateway struct {
	PerOwner bool `json:"perOwner,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: how long the volumes a runtime migration copied from are kept once the machine has booted from the copy, and how many copy Jobs may run at once in the install and for one owner. Zero means the controller's default for each. `CloneSource` says whether the copy reads a CSI clone of a single-node home volume rather than the volume itself; unset means it does.
type VMRuntimeMigration struct {
	Retention        Duration `json:"retention,omitempty"`
	Concurrency      int      `json:"concurrency,omitempty"`
	OwnerConcurrency int      `json:"ownerConcurrency,omitempty"`
	CloneSource      *bool    `json:"cloneSource,omitempty"`
}

type VMRunnerSpec struct {
	Image                string                        `json:"image,omitempty"`
	ImagePullPolicy      string                        `json:"imagePullPolicy,omitempty"`
	ImagePullSecrets     []corev1.LocalObjectReference `json:"imagePullSecrets,omitempty"`
	ServiceAccountName   string                        `json:"serviceAccountName,omitempty"`
	Storage              string                        `json:"storage,omitempty"`
	StorageClass         string                        `json:"storageClass,omitempty"`
	Devices              map[string]string             `json:"devices,omitempty"`
	ReserveMiB           int                           `json:"reserveMiB,omitempty"`
	HeadroomMiB          int                           `json:"headroomMiB,omitempty"`
	BootMiB              int                           `json:"bootMiB,omitempty"`
	MachineCPUs          int                           `json:"machineCPUs,omitempty"`
	NestedVirtualization bool                          `json:"nestedVirtualization,omitempty"`
	ImageCacheHostPath   string                        `json:"imageCacheHostPath,omitempty"`
	ImageCacheBudget     string                        `json:"imageCacheBudget,omitempty"`
	NodeSelector         map[string]string             `json:"nodeSelector,omitempty"`
	Tolerations          []corev1.Toleration           `json:"tolerations,omitempty"`
	Affinity             *corev1.Affinity              `json:"affinity,omitempty"`
	Resources            *corev1.ResourceRequirements  `json:"resources,omitempty"`
	Rollout              VMRunnerRollout               `json:"rollout,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: set, every vm machine runs on one runner outside the cluster, reached at this address, instead of on per-owner runner pods. It is for a local cluster on a laptop, whose hypervisor the runner uses directly rather than nesting one inside the cluster's VM; the chart renders that runner's token and certificate, and the install starts it.
	HostAddress string `json:"hostAddress,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the node directory a stager DaemonSet copies each runner release into. A runner pod keeps the image it was created with, and its loader takes a new release from here without restarting the machines. Required for runner pods.
	ReleaseHostPath string `json:"releaseHostPath,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: how smolvm checks every VMM's syscalls against its allowlist: `audit` logs a call outside it, `enforce` kills the VMM, `off` installs no filter. Empty means `enforce`.
	Seccomp string `json:"seccomp,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the PriorityClass every runner pod runs under, rendered by the chart above the pods of agents and above the platform's own control plane, which the chart leaves at no class. A node under memory pressure evicts, and a full node preempts, the lowest priority first, and a runner going down takes every machine of its owner with it — a whole owner's agents for one pod — where an agent pod going down costs one agent. Empty leaves runner pods at the cluster default.
	PriorityClassName string `json:"priorityClassName,omitempty"`
}

type VMRunnerClusterDNS struct {
	Namespace string            `json:"namespace,omitempty"`
	PodLabels map[string]string `json:"podLabels,omitempty"`
	Ports     []int32           `json:"ports,omitempty"`
}

// UNIT_BOUNDARY_DESCRIPTION: where a gateway may go inside the network, beyond the public internet and the platform's own pods. ExtraCIDRs are private ranges an install opens for its own enterprise services; the cloud metadata endpoints stay closed inside them. ClusterDNS selects the cluster DNS pods the gateway resolves upstream names through. Peers are in-cluster pods an install opens to every gateway, such as a self-hosted model server, selected by namespace and non-empty pod labels, on their own TCP ports; Mesh marks a peer in the ambient mesh, which also opens HBONE 15008, and over HBONE ztunnel carries any inner port, so the port list binds only peers outside the mesh.
type GatewayEgress struct {
	ExtraCIDRs []string            `json:"extraCidrs,omitempty"`
	ClusterDNS VMRunnerClusterDNS  `json:"clusterDns,omitempty"`
	Peers      []GatewayEgressPeer `json:"peers,omitempty"`
}

type GatewayEgressPeer struct {
	Namespace string            `json:"namespace"`
	PodLabels map[string]string `json:"podLabels,omitempty"`
	Ports     []int32           `json:"ports"`
	Mesh      bool              `json:"mesh,omitempty"`
}

type VMRunnerRollout struct {
	// UNIT_BOUNDARY_DESCRIPTION: how many runners may be mid-roll or mid-hand-off at once: a count, or, when MaxConcurrentPercent is set, that share of the runners the install has. A count alone cannot express a width that keeps up: one runner at a time takes an install of a thousand owners days to roll.
	MaxConcurrent int `json:"maxConcurrent,omitempty"`
	// UNIT_BOUNDARY_DESCRIPTION: the roll's width as a share of the runners the install has, 1 to 100, rounded up to at least one runner. Zero leaves the width to MaxConcurrent.
	MaxConcurrentPercent int      `json:"maxConcurrentPercent,omitempty"`
	SettleTimeout        Duration `json:"settleTimeout,omitempty"`
	IdleWait             Duration `json:"idleWait,omitempty"`
}

type AgentProbes struct {
	Startup   *corev1.Probe `json:"startup,omitempty"`
	Readiness *corev1.Probe `json:"readiness,omitempty"`
	Liveness  *corev1.Probe `json:"liveness,omitempty"`
}

type AgentTemplateDefaults struct {
	AgentHome string `json:"agentHome,omitempty"`

	ImagePullPolicy string                       `json:"imagePullPolicy,omitempty"`
	StorageSize     string                       `json:"storageSize,omitempty"`
	Resources       *corev1.ResourceRequirements `json:"resources,omitempty"`

	Mounts       []Mount       `json:"mounts,omitempty"`
	Env          []EnvVar      `json:"env,omitempty"`
	SkillSources []SkillSource `json:"skillSources,omitempty"`
	Init         string        `json:"init,omitempty"`

	NestedVirtualization bool `json:"nestedVirtualization,omitempty"`
}

type WarmPool struct {
	Enabled             bool           `json:"enabled,omitempty"`
	StorageClass        string         `json:"storageClass,omitempty"`
	ReplenishInterval   Duration       `json:"replenishInterval,omitempty"`
	MaxProvisioningTime Duration       `json:"maxProvisioningTime,omitempty"`
	Sizes               []WarmPoolSize `json:"sizes,omitempty"`
}

type WarmPoolSize struct {
	Size   string `json:"size"`
	Target int    `json:"target"`
}

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

type StorageMigration struct {
	Enabled               bool     `json:"enabled,omitempty"`
	Concurrency           int      `json:"concurrency,omitempty"`
	Interval              Duration `json:"interval,omitempty"`
	TargetStorageClass    string   `json:"targetStorageClass,omitempty"`
	AllowSameStorageClass bool     `json:"allowSameStorageClass,omitempty"`
	MinTargetSize         string   `json:"minTargetSize,omitempty"`
	AllowOwnershipRemap   bool     `json:"allowOwnershipRemap,omitempty"`
	JobImage              string   `json:"jobImage,omitempty"`
}
