package types

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
	"github.com/teambition/rrule-go"
	"gopkg.in/yaml.v3"
	"k8s.io/apimachinery/pkg/api/resource"
)

var quietHoursTimeRE = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

const SpecVersion = "agent-platform.ai/v1"

// --- Agent ---

type AgentSpec struct {
	Version         string                      `yaml:"version"`
	Name            string                      `yaml:"name,omitempty"`
	Image           string                      `yaml:"image"`
	Description     string                      `yaml:"description,omitempty"`
	Mounts          []Mount                     `yaml:"mounts,omitempty"`
	Init            string                      `yaml:"init,omitempty"`
	Env             []EnvVar                    `yaml:"env,omitempty"`
	Resources       ResourceSpec                `yaml:"resources,omitempty"`
	SecurityContext *SecurityContext             `yaml:"securityContext,omitempty"`
}

type Mount struct {
	Path    string `yaml:"path"`
	Persist bool   `yaml:"persist"`
	// Size is an optional K8s resource Quantity (e.g. "2Gi") for a persisted
	// mount's PVC. When empty the controller defaults to 10Gi to match the
	// pre-issue-#244 behavior. Ignored when Persist is false.
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

type SecurityContext struct {
	RunAsNonRoot           *bool `yaml:"runAsNonRoot,omitempty"`
	ReadOnlyRootFilesystem *bool `yaml:"readOnlyRootFilesystem,omitempty"`
}

// --- MCP Server ---

type MCPServerConfig struct {
	Type    string   `yaml:"type"`              // "stdio" or "http"
	Command string   `yaml:"command,omitempty"` // stdio: command to run
	Args    []string `yaml:"args,omitempty"`    // stdio: command arguments
	URL     string   `yaml:"url,omitempty"`     // http: server URL
}

// --- Instance ---

type InstanceSpec struct {
	Version      string   `yaml:"version"`
	DesiredState string   `yaml:"desiredState"`
	AgentName    string   `yaml:"agentId,omitempty"`
	Env          []EnvVar `yaml:"env,omitempty"`
	SecretRef    string   `yaml:"secretRef,omitempty"`
	Description  string   `yaml:"description,omitempty"`
}

type InstanceStatus struct {
	Version      string `yaml:"version"`
	CurrentState string `yaml:"currentState"`
	Error        string `yaml:"error,omitempty"`
}

// --- Schedule ---

// ScheduleSpec is a discriminated union on Type:
//
//   - "cron"  (legacy): fires on Cron, UTC.
//   - "rrule" (new):    fires on RRule, interpreted in Timezone;
//                       candidates inside any enabled QuietHours window are skipped.
//
// Backwards-compat: schedules created before ADR-031 still carry only Type="cron"
// and Cron; the scheduler keeps a robfig/cron path for them.
type ScheduleSpec struct {
	Version     string                     `yaml:"version"`
	Type        string                     `yaml:"type"`
	Cron        string                     `yaml:"cron,omitempty"`
	RRule       string                     `yaml:"rrule,omitempty"`
	Timezone    string                     `yaml:"timezone,omitempty"`
	QuietHours  []QuietWindow              `yaml:"quietHours,omitempty"`
	Task        string                     `yaml:"task,omitempty"`
	Enabled     bool                       `yaml:"enabled"`
	MCPServers  map[string]MCPServerConfig `yaml:"mcpServers,omitempty"`
	SessionMode string                     `yaml:"sessionMode,omitempty"`
}

// QuietWindow is a daily time-of-day range in the schedule's Timezone.
// If EndTime <= StartTime the window crosses midnight (e.g. 22:00 → 06:00).
// StartTime/EndTime are "HH:MM" (24-hour).
type QuietWindow struct {
	StartTime string `yaml:"startTime"`
	EndTime   string `yaml:"endTime"`
	Enabled   bool   `yaml:"enabled"`
}

const (
	ScheduleTypeCron  = "cron"
	ScheduleTypeRRule = "rrule"
)

type ScheduleStatus struct {
	Version    string `yaml:"version"`
	LastRun    string `yaml:"lastRun,omitempty"`
	NextRun    string `yaml:"nextRun,omitempty"`
	LastResult string `yaml:"lastResult,omitempty"`
}

// --- Fork ---

type ForkSpec struct {
	Version    string `yaml:"version"`
	Instance   string `yaml:"instance"`
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
	var spec AgentSpec
	if err := yaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing agent spec: %w", err)
	}
	if err := validateVersion(spec.Version); err != nil {
		return nil, fmt.Errorf("agent spec: %w", err)
	}
	if spec.Image == "" {
		return nil, fmt.Errorf("agent spec: image is required")
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

func ParseInstanceSpec(data string) (*InstanceSpec, error) {
	var spec InstanceSpec
	if err := yaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing instance spec: %w", err)
	}
	if err := validateVersion(spec.Version); err != nil {
		return nil, fmt.Errorf("instance spec: %w", err)
	}
	if spec.DesiredState == "" {
		return nil, fmt.Errorf("instance spec: desiredState is required")
	}
	if spec.DesiredState != "running" && spec.DesiredState != "hibernated" {
		return nil, fmt.Errorf("instance spec: desiredState must be 'running' or 'hibernated', got %q", spec.DesiredState)
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
	if spec.Instance == "" {
		return nil, fmt.Errorf("fork spec: instance is required")
	}
	if spec.ForeignSub == "" {
		return nil, fmt.Errorf("fork spec: foreignSub is required")
	}
	return &spec, nil
}

func NewForkStatus(phase, jobName, podIP string, forkErr *ForkError) *ForkStatus {
	return &ForkStatus{Version: SpecVersion, Phase: phase, JobName: jobName, PodIP: podIP, Error: forkErr}
}

func ParseScheduleSpec(data string) (*ScheduleSpec, error) {
	var spec ScheduleSpec
	if err := yaml.Unmarshal([]byte(data), &spec); err != nil {
		return nil, fmt.Errorf("parsing schedule spec: %w", err)
	}
	if err := validateVersion(spec.Version); err != nil {
		return nil, fmt.Errorf("schedule spec: %w", err)
	}

	// Legacy schedules don't carry `type`; infer it so old records still validate.
	specType := spec.Type
	if specType == "" {
		if spec.RRule != "" {
			specType = ScheduleTypeRRule
		} else {
			specType = ScheduleTypeCron
		}
	}

	switch specType {
	case ScheduleTypeCron:
		if spec.Cron != "" {
			if _, err := cron.ParseStandard(spec.Cron); err != nil {
				return nil, fmt.Errorf("schedule spec: invalid cron %q: %w", spec.Cron, err)
			}
		}
	case ScheduleTypeRRule:
		if spec.RRule == "" {
			return nil, fmt.Errorf("schedule spec: rrule is required for type=rrule")
		}
		if _, err := ParseRRuleInLocation(spec.RRule, spec.Timezone); err != nil {
			return nil, fmt.Errorf("schedule spec: %w", err)
		}
	default:
		return nil, fmt.Errorf("schedule spec: unknown type %q", spec.Type)
	}

	if err := validateQuietHours(spec.QuietHours); err != nil {
		return nil, fmt.Errorf("schedule spec: %w", err)
	}
	if err := validateMCPServers(spec.MCPServers); err != nil {
		return nil, fmt.Errorf("schedule spec: %w", err)
	}
	return &spec, nil
}

// ParseRRuleInLocation parses an RRULE string in the given IANA timezone
// (empty string → UTC). rrule-go's StrToROptionInLocation requires a location
// so Dtstart/UNTIL resolve correctly; we supply one here for consistency
// with how the scheduler will evaluate the rule at fire time.
func ParseRRuleInLocation(rruleStr, tz string) (*rrule.RRule, error) {
	loc, err := LoadTimezone(tz)
	if err != nil {
		return nil, err
	}
	opt, err := rrule.StrToROptionInLocation(rruleStr, loc)
	if err != nil {
		return nil, fmt.Errorf("invalid rrule %q: %w", rruleStr, err)
	}
	r, err := rrule.NewRRule(*opt)
	if err != nil {
		return nil, fmt.Errorf("invalid rrule %q: %w", rruleStr, err)
	}
	return r, nil
}

// LoadTimezone loads an IANA timezone, defaulting to UTC when tz is empty.
// Exposed so the scheduler can share the same default.
func LoadTimezone(tz string) (*time.Location, error) {
	if tz == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("invalid timezone %q: %w", tz, err)
	}
	return loc, nil
}

func validateQuietHours(windows []QuietWindow) error {
	for i, w := range windows {
		if !quietHoursTimeRE.MatchString(w.StartTime) {
			return fmt.Errorf("quietHours[%d].startTime %q must be HH:MM", i, w.StartTime)
		}
		if !quietHoursTimeRE.MatchString(w.EndTime) {
			return fmt.Errorf("quietHours[%d].endTime %q must be HH:MM", i, w.EndTime)
		}
		if w.StartTime == w.EndTime {
			return fmt.Errorf("quietHours[%d]: startTime and endTime must differ", i)
		}
	}
	return nil
}

func validateMCPServers(servers map[string]MCPServerConfig) error {
	for name, s := range servers {
		switch s.Type {
		case "stdio":
			if s.Command == "" {
				return fmt.Errorf("mcpServer %q: stdio type requires command", name)
			}
		case "http":
			if s.URL == "" {
				return fmt.Errorf("mcpServer %q: http type requires url", name)
			}
		default:
			return fmt.Errorf("mcpServer %q: unsupported type %q (expected stdio or http)", name, s.Type)
		}
	}
	return nil
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

// NewInstanceStatus creates a status with the current version.
func NewInstanceStatus(state, errMsg string) *InstanceStatus {
	return &InstanceStatus{Version: SpecVersion, CurrentState: state, Error: errMsg}
}

// NewScheduleStatus creates a status with the current version.
func NewScheduleStatus(lastRun, nextRun, result string) *ScheduleStatus {
	return &ScheduleStatus{Version: SpecVersion, LastRun: lastRun, NextRun: nextRun, LastResult: result}
}
