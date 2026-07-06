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
