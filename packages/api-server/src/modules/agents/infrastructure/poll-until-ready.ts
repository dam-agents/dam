import type { AgentChangeSubscription } from "./agent-state-cache.js";

export interface PollTiming {
  initialMs: number;
  maxMs: number;
  timeoutMs: number;
  wakeOn?: () => AgentChangeSubscription;
}

function sleep(ms: number): { elapsed: Promise<void>; cancel(): void } {
  let timer: NodeJS.Timeout | undefined;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { elapsed, cancel: () => clearTimeout(timer) };
}

export async function pollUntilReady(
  isReady: () => Promise<boolean>,
  timing: PollTiming,
): Promise<boolean> {
  const deadline = Date.now() + timing.timeoutMs;
  let interval = timing.initialMs;
  while (Date.now() < deadline) {
    const wakeup = timing.wakeOn?.();
    try {
      if (await isReady()) return true;
      const waited = sleep(interval * (0.8 + 0.4 * Math.random()));
      try {
        await (wakeup
          ? Promise.race([waited.elapsed, wakeup.changed])
          : waited.elapsed);
      } finally {
        waited.cancel();
      }
    } finally {
      wakeup?.cancel();
    }
    interval = Math.min(Math.floor(interval * 1.5), timing.maxMs);
  }
  return false;
}

export const WAKE_POLL_INITIAL_MS = 500;
export const WAKE_POLL_MAX_MS = 5_000;
export const WAKE_TIMEOUT_MS = 120_000;

export const OVER_BUDGET_FAIL_FAST_GRACE_MS = 10_000;

export const PAUSE_SETTLE_POLL_MS = 2_000;
export const PAUSE_SETTLE_TIMEOUT_MS = 60_000;
