package store

import (
	"fmt"
	"sort"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: The wire format the agent cache and the reconciler read: the same labels and
// UNIT_BOUNDARY_DESCRIPTION: annotations the custom resource carried. They are the controller's whole
// UNIT_BOUNDARY_DESCRIPTION: vocabulary for an Agent, so this is the one place the rows become it.
const (
	labelOwner    = "agent-platform.ai/owner"
	labelTemplate = "agent-platform.ai/template"

	annLastActivity      = "agent-platform.ai/last-activity"
	annActiveSession     = "agent-platform.ai/active-session"
	annInvocationsActive = "agent-platform.ai/invocations-active"
	annStopRequested     = "agent-platform.ai/stop-requested"
	annDisabled          = "agent-platform.ai/disabled"
	annReclaimedAt       = "agent-platform.ai/reclaimed-at"
	annRollRev           = "agent-platform.ai/roll-rev"
	annSweepable         = "agent-platform.ai/sweepable"
	annMachineUp         = "agent-platform.ai/machine-up-at"
	annMachineDown       = "agent-platform.ai/machine-down-at"
	annMemoryWaitUntil   = "agent-platform.ai/memory-wait-until"
	annRunnerOOMKill     = "agent-platform.ai/runner-oom-kill"
	annRunnerOOMDone     = "agent-platform.ai/runner-oom-over"
)

// UNIT_BOUNDARY_DESCRIPTION: agentRow is a definition with the signals and observations that are read
// UNIT_BOUNDARY_DESCRIPTION: with it. The columns are the ones the controller's login is granted: nothing
// UNIT_BOUNDARY_DESCRIPTION: display-only, nothing the api-server alone writes.
type agentRow struct {
	ID                    string
	Incarnation           string
	OwnerSub              string
	TemplateID            *string
	EnvironmentOf         *string
	Name                  string
	Image                 string
	Harness               *string
	ImagePullSecretRef    *string
	SecretRef             *string
	HibernationTimeoutNs  *int64
	NestedVirtualization  bool
	RequireConnectionAddr bool
	TelemetryAttribution  *string
	CPULimit              string
	MemoryLimit           string
	DiskSize              *string
	MemoryFallbackBytes   *int64
	DiskFloorBytes        *int64
	Sweepable             bool
	LifetimeMs            *int64
	Generation            int64
	CreatedAt             time.Time

	SignalVersion        int64
	LastActivityAt       *time.Time
	LastActivityToken    *string
	SessionPinned        bool
	InvocationPinned     bool
	StopRequestedAt      *time.Time
	DisabledAt           *time.Time
	RollRev              string
	ReclaimedAt          *time.Time
	ReclaimedActivityTok *string
	ObservedGeneration   int64
	MachineRestarts      int32
	MachineRestartReason *string
	MachineUpAt          *time.Time
	MachineDownAt        *time.Time
	MemoryWaitUntil      *time.Time
	RunnerOOMKillID      *string
	RunnerOOMRecoveredID *string
}

type agentChildren struct {
	conditions []metav1.Condition
	hosts      []string
	grants     []string
}

// UNIT_BOUNDARY_DESCRIPTION: hydrate turns one definition and its children into the object the controller
// UNIT_BOUNDARY_DESCRIPTION: reconciles, in the shape the custom resource had.
func hydrate(namespace string, row agentRow, children agentChildren) *unstructured.Unstructured {
	labels := map[string]any{labelOwner: row.OwnerSub}
	if row.TemplateID != nil && *row.TemplateID != "" {
		labels[labelTemplate] = *row.TemplateID
	}

	annotations := map[string]any{}
	putTime(annotations, annLastActivity, row.LastActivityAt)
	if row.SessionPinned {
		annotations[annActiveSession] = "true"
	}
	if row.InvocationPinned {
		annotations[annInvocationsActive] = "true"
	}
	putTime(annotations, annStopRequested, row.StopRequestedAt)
	putTime(annotations, annDisabled, row.DisabledAt)
	// UNIT_BOUNDARY_DESCRIPTION: The reclaim mark applies only to the activity it was stamped for, and a
	// UNIT_BOUNDARY_DESCRIPTION: sleep, a disable or a wake rotates the token, which is what retires it.
	if row.ReclaimedAt != nil && row.ReclaimedActivityTok != nil &&
		row.LastActivityToken != nil && *row.ReclaimedActivityTok == *row.LastActivityToken {
		putTime(annotations, annReclaimedAt, row.ReclaimedAt)
	}
	if row.RollRev != "" {
		annotations[annRollRev] = row.RollRev
	}
	if row.Sweepable {
		annotations[annSweepable] = "true"
	}
	putTime(annotations, annMachineUp, row.MachineUpAt)
	putTime(annotations, annMachineDown, row.MachineDownAt)
	putTime(annotations, annMemoryWaitUntil, row.MemoryWaitUntil)
	putString(annotations, annRunnerOOMKill, row.RunnerOOMKillID)
	putString(annotations, annRunnerOOMDone, row.RunnerOOMRecoveredID)

	spec := map[string]any{
		"image":     row.Image,
		"resources": map[string]any{"limits": map[string]any{"cpu": row.CPULimit, "memory": row.MemoryLimit}},
	}
	if row.Name != "" {
		spec["name"] = row.Name
	}
	putSpec(spec, "harness", row.Harness)
	putSpec(spec, "imagePullSecretRef", row.ImagePullSecretRef)
	putSpec(spec, "secretRef", row.SecretRef)
	putSpec(spec, "telemetryAttributionId", row.TelemetryAttribution)
	putSpec(spec, "environmentOf", row.EnvironmentOf)
	if row.HibernationTimeoutNs != nil {
		spec["hibernationTimeout"] = time.Duration(*row.HibernationTimeoutNs).String()
	}
	if row.NestedVirtualization {
		spec["nestedVirtualization"] = true
	}
	if row.RequireConnectionAddr {
		spec["requireConnectionAddress"] = true
	}
	if disk := diskOf(row); disk != "" {
		spec["storageSize"] = disk
	}
	if len(children.hosts) > 0 {
		spec["l7Hosts"] = anyList(children.hosts)
	}
	if len(children.grants) > 0 {
		spec["grantedConnectionIds"] = anyList(children.grants)
	}

	status := map[string]any{}
	if row.ObservedGeneration > 0 {
		status["observedGeneration"] = row.ObservedGeneration
	}
	if row.MachineRestarts > 0 {
		status["agentPodRestarts"] = int64(row.MachineRestarts)
	}
	if row.MachineRestartReason != nil && *row.MachineRestartReason != "" {
		status["agentPodRestartReason"] = *row.MachineRestartReason
	}
	if len(children.conditions) > 0 {
		conditions := make([]any, 0, len(children.conditions))
		for _, condition := range children.conditions {
			conditions = append(conditions, map[string]any{
				"type":               condition.Type,
				"status":             string(condition.Status),
				"reason":             condition.Reason,
				"message":            condition.Message,
				"observedGeneration": condition.ObservedGeneration,
				"lastTransitionTime": condition.LastTransitionTime.UTC().Format(time.RFC3339),
			})
		}
		status["conditions"] = conditions
	}

	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiv1.GroupVersion.String(),
		"kind":       "Agent",
		"metadata": map[string]any{
			"name":              row.ID,
			"namespace":         namespace,
			"uid":               row.Incarnation,
			"generation":        row.Generation,
			"resourceVersion":   fmt.Sprintf("%d", row.SignalVersion),
			"creationTimestamp": row.CreatedAt.UTC().Format(time.RFC3339),
			"labels":            labels,
			"annotations":       annotations,
		},
		"spec":   spec,
		"status": status,
	}}
	return object
}

// UNIT_BOUNDARY_DESCRIPTION: diskOf is the size the machine is asked for: the definition's own size, or
// UNIT_BOUNDARY_DESCRIPTION: the larger legacy floor an absorbed persisted mount wrote. The mount list
// UNIT_BOUNDARY_DESCRIPTION: itself is not a row, since only its total ever reached a machine.
func diskOf(row agentRow) string {
	if row.DiskFloorBytes == nil {
		if row.DiskSize != nil {
			return *row.DiskSize
		}
		return ""
	}
	floor := resource.NewQuantity(*row.DiskFloorBytes, resource.BinarySI)
	if row.DiskSize == nil || *row.DiskSize == "" {
		return floor.String()
	}
	own, err := resource.ParseQuantity(*row.DiskSize)
	if err != nil || own.Cmp(*floor) < 0 {
		return floor.String()
	}
	return *row.DiskSize
}

// UNIT_BOUNDARY_DESCRIPTION: an unstructured object holds only JSON values, and a []string is not one. Everything below that reads it deep-copies the map, which panics on anything else.
func anyList(values []string) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}

func putTime(into map[string]any, key string, value *time.Time) {
	if value != nil && !value.IsZero() {
		into[key] = value.UTC().Format(time.RFC3339Nano)
	}
}

func putString(into map[string]any, key string, value *string) {
	if value != nil && *value != "" {
		into[key] = *value
	}
}

func putSpec(spec map[string]any, key string, value *string) {
	if value != nil && *value != "" {
		spec[key] = *value
	}
}

func sorted(values []string) []string {
	sort.Strings(values)
	return values
}
