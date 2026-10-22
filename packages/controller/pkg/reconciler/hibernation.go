package reconciler

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	annActiveSession              = "agent-platform.ai/active-session"
	annLastActivity               = "agent-platform.ai/last-activity"
	annInvocationsActive          = "agent-platform.ai/invocations-active"
	annStopRequested              = "agent-platform.ai/stop-requested"
	annStorageMigration           = "agent-platform.ai/storage-migration"
	annStorageMigrationWasRunning = "agent-platform.ai/storage-migration-was-running"
	annReclaimedAt                = "agent-platform.ai/reclaimed-at"
	annMemoryWaitUntil            = "agent-platform.ai/memory-wait-until"
	annSweepable                  = "agent-platform.ai/sweepable"
)

func shouldRun(annotations map[string]string, idleTimeout time.Duration, now time.Time) bool {
	if annotations[annStopRequested] != "" || annotations[annStorageMigration] != "" {
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

// UNIT_BOUNDARY_DESCRIPTION: whether an Agent should run, with its runtime migration taken into account: nothing runs while the migration holds it down, and a boot the migration waits on runs whatever the activity or a stop says, unless a storage migration gates it.
func shouldRunMigrating(annotations map[string]string, m runtimeMigration, idleTimeout time.Duration, now time.Time) bool {
	if m.holdsDown() {
		return false
	}
	if m.keepsUp() && !m.stopHolds(annotations) && annotations[annStorageMigration] == "" {
		return true
	}
	return shouldRun(annotations, idleTimeout, now)
}

// UNIT_BOUNDARY_DESCRIPTION: the idle window an Agent hibernates after: its own override, else the chart-wide default, which is a separate value for vm Agents. A vm Agent is not offered the setting, so it reads the vm default; one that carries an override anyway — a Template or starter kit seed, or one whose Backend moved — honours it, as a container Agent does.
func effectiveIdleTimeout(override *metav1.Duration, vm bool, base config.AgentBase) time.Duration {
	if override != nil {
		return override.Duration
	}
	if vm {
		return base.VMIdleTimeout.AsDuration()
	}
	return base.IdleTimeout.AsDuration()
}
