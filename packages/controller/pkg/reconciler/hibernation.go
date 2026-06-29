package reconciler

import "time"

// Activity annotations the api-server stamps on an Agent — the only inputs to the run/hibernate decision.
const (
	annActiveSession = "agent-platform.ai/active-session"
	annLastActivity  = "agent-platform.ai/last-activity"
	// User-initiated hard stop (#1900): forces hibernation, overriding activity and disabled auto-hibernation.
	annStopRequested = "agent-platform.ai/stop-requested"
)

// shouldRun is the single run/hibernate decision shared by the reconciler (scales up on true)
// and the idle checker (treats false as a scale-down candidate). Fails open on missing data.
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
