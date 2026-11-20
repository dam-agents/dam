package reconciler

import (
	"time"

	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const (
	annActiveSession     = "agent-platform.ai/active-session"
	annLastActivity      = "agent-platform.ai/last-activity"
	annInvocationsActive = "agent-platform.ai/invocations-active"
	annStopRequested     = "agent-platform.ai/stop-requested"
	annReclaimedAt       = "agent-platform.ai/reclaimed-at"
	annMemoryWaitUntil   = "agent-platform.ai/memory-wait-until"
	annSweepable         = "agent-platform.ai/sweepable"
)

func shouldRun(annotations map[string]string, idleTimeout time.Duration, now time.Time) bool {
	if annotations[annStopRequested] != "" {
		return false
	}
	if idleTimeout <= 0 {
		return true
	}
	if annotations[annActiveSession] == "true" {
		return true
	}
	if annotations[annInvocationsActive] == "true" {
		return true
	}
	last := annotations[annLastActivity]
	if last == "" {
		return true
	}
	t, err := time.Parse(time.RFC3339, last)
	if err != nil {
		return true
	}
	if r, err := time.Parse(time.RFC3339, annotations[annReclaimedAt]); err == nil && !t.After(r) {
		return false
	}
	return now.Sub(t) <= idleTimeout
}

// UNIT_BOUNDARY_DESCRIPTION: a sweepable Agent parked for room is an Invocation target that has not started: it keeps asking to run until a stop or its Invocation's deadline, since a hibernation would let the Agent Sweep delete it and fail the Invocation as a deleted target instead of one that waited for room. The wait is read from Ready and from the machine's own condition, since a boot the runner already admitted and the node has not yet granted memory for keeps running and reads Ready as plain PodsNotReady, with the wait only on AgentPodReady.
func parkedTargetWaits(annotations map[string]string, reasons ...string) bool {
	if annotations[annSweepable] != "true" || annotations[annStopRequested] != "" {
		return false
	}
	for _, reason := range reasons {
		switch reason {
		case apiv1.ReasonOverBudget, apiv1.ReasonAwaitingMemory, apiv1.ReasonAwaitingAllocation, apiv1.ReasonAwaitingWarmUp, apiv1.ReasonAllocationUnreadable,
			vmrunner.ReasonAwaitingAllocation, vmrunner.ReasonOutOfCapacity:
			return true
		}
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: the idle window an Agent hibernates after: its own override, else the chart-wide default. An ordinary Agent is not offered the setting, so it reads the install's default; an Environment carries the idle timeout its owning Agent gave it, and one that carries an override anyway — a Template or starter kit seed — honours it.
func effectiveIdleTimeout(override *metav1.Duration, base config.AgentBase) time.Duration {
	if override != nil {
		return override.Duration
	}
	return base.VMIdleTimeout.AsDuration()
}

// UNIT_BOUNDARY_DESCRIPTION: the reason a condition of the status carries, or none when the status has no such condition.
func readReason(conds []metav1.Condition, condType string) string {
	if cond := apimeta.FindStatusCondition(conds, condType); cond != nil {
		return cond.Reason
	}
	return ""
}
