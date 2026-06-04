package types

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
	"k8s.io/apimachinery/pkg/api/resource"
	sigsyaml "sigs.k8s.io/yaml"
)

const SpecVersion = "agent-platform.ai/v1"

// --- Agent ---

// AgentSpec is the parsed Agent ConfigMap (spec.yaml) — the sole durable
// per-agent resource after ADR-046 collapsed Instance into Agent. It carries
// the fields a template can declare, plus the optional Layer B overrides
// (ImagePullPolicy, StorageSize, Resources) that fall back to chart-wide
// `controller.agent.templateDefaults.*` when empty, and the formerly
// per-instance runtime fields (`DesiredState`, `SecretRef`) that the
// api-server now writes onto the Agent CM directly.
//
// Security context and scheduling/metadata are chart-only — they live on
// `config.AgentBase` and cannot be set here by design.
type AgentSpec struct {
	Version     string       `yaml:"version" json:"version"`
	Name        string       `yaml:"name,omitempty" json:"name,omitempty"`
	Image       string       `yaml:"image" json:"image"`
	Description string       `yaml:"description,omitempty" json:"description,omitempty"`
	Init        string       `yaml:"init,omitempty" json:"init,omitempty"`
	SkillPaths  []string     `yaml:"skillPaths,omitempty" json:"skillPaths,omitempty"`
	Mounts      []Mount      `yaml:"mounts,omitempty" json:"mounts,omitempty"`
	Env         []EnvVar     `yaml:"env,omitempty" json:"env,omitempty"`
	Resources   ResourceSpec `yaml:"resources,omitempty" json:"resources,omitempty"`

	// Layer B overrides for chart-wide AgentTemplateDefaults. Empty = inherit.
	ImagePullPolicy string `yaml:"imagePullPolicy,omitempty" json:"imagePullPolicy,omitempty"`
	StorageSize     string `yaml:"storageSize,omitempty" json:"storageSize,omitempty"`
	// AgentHome is the HOME inside the agent container. The chart writes
	// this into spec.yaml from the template's `agentHome` (with chart-wide
	// fallback), so any `$HOME` literals in Mounts / SkillPaths are already
	// resolved by the time the controller sees them.
	AgentHome string `yaml:"agentHome,omitempty" json:"agentHome,omitempty"`

	// Runtime fields — moved here from the retired InstanceSpec (ADR-046).
	// DesiredState drives StatefulSet replicas (running → 1, hibernated → 0).
	// SecretRef names a K8s Secret whose keys are envFrom-projected into the
	// agent container (operator-supplied envs).
	DesiredState string `yaml:"desiredState,omitempty" json:"desiredState,omitempty"`
	SecretRef    string `yaml:"secretRef,omitempty" json:"secretRef,omitempty"`
}

// AgentStatus is the runtime status the controller writes onto the Agent
// ConfigMap's `status.yaml`. Replaces the previous InstanceStatus.
type AgentStatus struct {
	Version      string `yaml:"version"`
	CurrentState string `yaml:"currentState"`
	Error        string `yaml:"error,omitempty"`
}

type Mount struct {
	Path    string `yaml:"path"`
	Persist bool   `yaml:"persist"`
	// Size is an optional K8s resource Quantity (e.g. "2Gi") for a persisted
	// mount's PVC. Empty = falls back to AgentSpec.StorageSize, then to
	// AgentTemplateDefaults.StorageSize. Ignored when Persist is false.
	Size string `yaml:"size,omitempty"`
}

type EnvVar struct {
	Name  string `yaml:"name"`
	Value string `yaml:"value"`
}

type ResourceSpec struct {
	Requests map[string]string `yaml:"requests,omitempty"`
	Limits   map[string]string `yaml:"limits,omitempty"`
}

// --- Fork ---

// ForkSpec is the per-turn ephemeral runtime that derives from an Agent
// (ADR-046: Forks survived the Instance/Agent collapse). The `AgentName`
// names the parent Agent CM the fork impersonates; the parent's egress
// surface scopes what the fork can reach.
type ForkSpec struct {
	Version    string `yaml:"version"`
	AgentName  string `yaml:"agentName"`
	ForeignSub string `yaml:"foreignSub"`
	SessionID  string `yaml:"sessionId,omitempty"`
}

type ForkError struct {
	Reason string `yaml:"reason"`
	Detail string `yaml:"detail,omitempty"`
}

type ForkStatus struct {
	Version string     `yaml:"version"`
	Phase   string     `yaml:"phase"`
	JobName string     `yaml:"jobName,omitempty"`
	PodIP   string     `yaml:"podIP,omitempty"`
	Error   *ForkError `yaml:"error,omitempty"`
}

const (
	ForkPhasePending   = "Pending"
	ForkPhaseReady     = "Ready"
	ForkPhaseFailed    = "Failed"
	ForkPhaseCompleted = "Completed"

	ForkReasonCredentialMintFailed = "CredentialMintFailed"
	ForkReasonOrchestrationFailed  = "OrchestrationFailed"
	ForkReasonPodNotReady          = "PodNotReady"
	ForkReasonTimeout              = "Timeout"
)

// --- Parsing + Validation ---

func ParseAgentSpec(data string) (*AgentSpec, error) {
	// sigs.k8s.io/yaml routes through JSON unmarshaling so JSON-tagged
	// fields parse cleanly even when only json tags are present. AgentSpec
	// fields match by case-insensitive Go field name, which is
	// behaviorally identical to the yaml.v3 unmarshal we used before.
	var spec AgentSpec
	if err := sigsyaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing agent spec: %w", err)
	}
	if err := validateVersion(spec.Version); err != nil {
		return nil, fmt.Errorf("agent spec: %w", err)
	}
	if spec.Image == "" {
		return nil, fmt.Errorf("agent spec: image is required")
	}
	// DesiredState is optional; the controller defaults it to "running" when
	// omitted. When set, it must be one of the two known values — the same
	// invariant the retired InstanceSpec carried.
	if spec.DesiredState != "" && spec.DesiredState != "running" && spec.DesiredState != "hibernated" {
		return nil, fmt.Errorf("agent spec: desiredState must be 'running' or 'hibernated', got %q", spec.DesiredState)
	}
	for _, m := range spec.Mounts {
		if !strings.HasPrefix(m.Path, "/") {
			return nil, fmt.Errorf("agent spec: mount path %q must be absolute", m.Path)
		}
		if m.Size != "" {
			if _, err := resource.ParseQuantity(m.Size); err != nil {
				return nil, fmt.Errorf("agent spec: mount %q size %q is not a valid K8s quantity: %w", m.Path, m.Size, err)
			}
		}
	}
	return &spec, nil
}

func ParseForkSpec(data string) (*ForkSpec, error) {
	var spec ForkSpec
	if err := yaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing fork spec: %w", err)
	}
	if err := validateVersion(spec.Version); err != nil {
		return nil, fmt.Errorf("fork spec: %w", err)
	}
	if spec.AgentName == "" {
		return nil, fmt.Errorf("fork spec: agentName is required")
	}
	if spec.ForeignSub == "" {
		return nil, fmt.Errorf("fork spec: foreignSub is required")
	}
	return &spec, nil
}

func NewForkStatus(phase, jobName, podIP string, forkErr *ForkError) *ForkStatus {
	return &ForkStatus{Version: SpecVersion, Phase: phase, JobName: jobName, PodIP: podIP, Error: forkErr}
}

func validateVersion(v string) error {
	if v == "" {
		return fmt.Errorf("version is required (expected %q)", SpecVersion)
	}
	if v != SpecVersion {
		return fmt.Errorf("unsupported version %q (expected %q)", v, SpecVersion)
	}
	return nil
}

// SanitizeMountName converts a mount path to a K8s-safe volume name.
// "/workspace" -> "workspace", "/home/agent" -> "home-agent"
func SanitizeMountName(path string) string {
	name := strings.TrimPrefix(path, "/")
	return strings.ReplaceAll(name, "/", "-")
}

// NewAgentStatus creates a status with the current version.
func NewAgentStatus(state, errMsg string) *AgentStatus {
	return &AgentStatus{Version: SpecVersion, CurrentState: state, Error: errMsg}
}
