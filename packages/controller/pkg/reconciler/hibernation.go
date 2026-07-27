package reconciler

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Activity annotations the api-server stamps on an Agent. They are the only
// inputs to the run/hibernate decision now that desiredState is gone.
const (
	annActiveSession = "agent-platform.ai/active-session"
	annLastActivity  = "agent-platform.ai/last-activity"
	// Experiments v2 pin (#2942): "true" while the agent drives a running
	// experiment, so the idle checker can't kill the loop mid-run. Set and
	// cleared by the api-server on experiment lifecycle transitions; the
	// inactivity sweep failing a silent run is what eventually releases a
	// crashed loop's pin. Subordinate to a hard stop, like the session pin.
	annExperimentActive = "agent-platform.ai/experiment-active"
	// User-initiated hard stop (#1900): non-empty forces the pair down,
	// overriding activity and disabled auto-hibernation. Cleared only by an
	// explicit wake or a schedule fire — background activity bumps never
	// touch it, so a stopped agent stays stopped under open UI polls.
	annStopRequested = "agent-platform.ai/stop-requested"
	// Ephemeral invocation target (#2942), stamped by the api-server at
	// create. Read by the budget gate: sweepable agents are exempt from the
	// denied-wake memo (their driver is blocked waiting on the result, so a
	// spontaneous start once room frees is wanted, not a surprise).
	annSweepable = "agent-platform.ai/sweepable"
)

// shouldRun reports whether an agent should be scaled up, derived purely from
// activity annotations. It is the single decision function shared by the
// reconciler (which scales *up* when it returns true) and the idle checker
// (which treats a false result as a scale-*down* candidate), so the two can
// never disagree.
//
// It fails open: an agent runs when auto-hibernation is disabled
// (idleTimeout <= 0) or when the last-activity stamp is missing or unparseable.
// Hibernation is therefore only ever the result of a *positive* idle signal,
// never of absent data.
func shouldRun(annotations map[string]string, idleTimeout time.Duration, now time.Time) bool {
	// A hard stop overrides every run signal, including disabled
	// auto-hibernation — it is the one *negative* override in the model.
	if annotations[annStopRequested] != "" {
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
	return now.Sub(t) <= idleTimeout
}

// effectiveIdleTimeout resolves the per-agent override (nil = inherit the global; "0s" = never hibernate) against the chart-wide default.
func effectiveIdleTimeout(override *metav1.Duration, global time.Duration) time.Duration {
	if override == nil {
		return global
	}
	return override.Duration
}
