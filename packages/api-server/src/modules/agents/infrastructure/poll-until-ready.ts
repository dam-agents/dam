const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function pollUntilReady(
  isReady: () => Promise<boolean>,
  initialMs: number,
  maxMs: number,
  timeoutMs: number,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let interval = initialMs;
  while (Date.now() < deadline) {
    if (await isReady()) return true;
    const jittered = interval * (0.8 + 0.4 * Math.random());
    await wait(jittered);
    interval = Math.min(Math.floor(interval * 1.5), maxMs);
  }
  return false;
}

export const WAKE_POLL_INITIAL_MS = 500;
export const WAKE_POLL_MAX_MS = 5_000;
export const WAKE_TIMEOUT_MS = 120_000;

export const OVER_BUDGET_FAIL_FAST_GRACE_MS = 10_000;

export const PAUSE_SETTLE_POLL_MS = 2_000;
export const PAUSE_SETTLE_TIMEOUT_MS = 60_000;
