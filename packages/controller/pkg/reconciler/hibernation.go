package reconciler

import "time"

// Activity annotations the api-server stamps on an Agent. They are the only
// inputs to the run/hibernate decision now that desiredState is gone (ADR-058).
const (
	annActiveSession = "agent-platform.ai/active-session"
	annLastActivity  = "agent-platform.ai/last-activity"
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
