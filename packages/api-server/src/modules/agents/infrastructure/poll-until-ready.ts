/**
 * Poll `isReady` with exponential backoff + jitter.
 *
 * Backoff: start fast so a quick wake is still detected quickly, then
 * slow down so a pod that takes longer doesn't get hammered for the
 * full deadline. Jitter: ±20% so many callers waking at once desync
 * within a few iterations instead of polling in lockstep bursts.
 *
 * Exported so the loop can be unit-tested with short intervals and a
 * deterministic isReady.
 */
export async function pollUntilReady(
  isReady: () => Promise<boolean>,
  initialMs: number,
  maxMs: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let interval = initialMs;
  while (Date.now() < deadline) {
    if (await isReady()) return true;
    const jittered = interval * (0.8 + 0.4 * Math.random());
    await new Promise((r) => setTimeout(r, jittered));
    interval = Math.min(Math.floor(interval * 1.5), maxMs);
  }
  return false;
}

export const WAKE_POLL_INITIAL_MS = 500;
export const WAKE_POLL_MAX_MS = 5_000;
export const WAKE_TIMEOUT_MS = 120_000;

// Over-budget fail-fast grace (#1900). A parked agent keeps its OverBudget
// condition standing, so a fresh wake's first polls may read the PREVIOUS
// attempt's denial — the condition doesn't say which attempt it applies to.
// The wake therefore treats OverBudget as ITS OWN denial only heuristically:
// immediately when the condition appeared during this wake's poll (a fresh
// verdict), else only once this grace has passed — long enough for the
// informer-driven reconcile of our activity bump to either admit (condition
// leaves OverBudget) or re-deny. Sized generously above the observed
// sub-second reconcile latency; the cost of a miss is one premature
// over-budget error, recovered by clicking start again.
export const OVER_BUDGET_FAIL_FAST_GRACE_MS = 10_000;

// Pause settle-watch (#1900): how long to wait for the controller to report
// Hibernated before giving up and leaving the hard stop in place (fail-safe
// in the strict direction — one explicit wake recovers).
export const PAUSE_SETTLE_POLL_MS = 2_000;
export const PAUSE_SETTLE_TIMEOUT_MS = 60_000;
