package reconciler

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
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

// UNIT_BOUNDARY_DESCRIPTION: the idle window an Agent hibernates after: its own override, else the chart-wide default. The Agent is not offered the setting, so it reads the install's default; one that carries an override anyway — a Template or starter kit seed — honours it.
func effectiveIdleTimeout(override *metav1.Duration, base config.AgentBase) time.Duration {
	if override != nil {
		return override.Duration
	}
	return base.VMIdleTimeout.AsDuration()
}
