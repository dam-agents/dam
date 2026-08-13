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
	Enabled      bool                `json:"enabled,omitempty"`
	ScratchSize  string              `json:"scratchSize,omitempty"`
	NodeSelector map[string]string   `json:"nodeSelector,omitempty"`
	Tolerations  []corev1.Toleration `json:"tolerations,omitempty"`
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
