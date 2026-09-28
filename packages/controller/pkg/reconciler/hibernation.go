package reconciler

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	annActiveSession              = "agent-platform.ai/active-session"
	annLastActivity               = "agent-platform.ai/last-activity"
	annExperimentActive           = "agent-platform.ai/experiment-active"
	annStopRequested              = "agent-platform.ai/stop-requested"
	annStorageMigration           = "agent-platform.ai/storage-migration"
	annStorageMigrationWasRunning = "agent-platform.ai/storage-migration-was-running"
	annReclaimedAt                = "agent-platform.ai/reclaimed-at"
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
	if annotations[annExperimentActive] == "true" {
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

// UNIT_BOUNDARY_DESCRIPTION: whether an Agent should run, with its runtime migration taken into account: nothing runs while the migration holds it down, and a boot the migration waits on runs whatever the activity says, unless the user stopped it or a storage migration gates it.
func shouldRunMigrating(annotations map[string]string, m runtimeMigration, idleTimeout time.Duration, now time.Time) bool {
	if m.holdsDown() {
		return false
	}
	if m.keepsUp() && annotations[annStopRequested] == "" && annotations[annStorageMigration] == "" {
		return true
	}
	return shouldRun(annotations, idleTimeout, now)
}

func effectiveIdleTimeout(override *metav1.Duration, global time.Duration) time.Duration {
	if override == nil {
		return global
	}
	return override.Duration
}
