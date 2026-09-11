import {
  isAgentWakeTimeoutError,
  isTransientWakeFailure,
} from "../../agents/index.js";

export const WAKE_WAIT_PATIENCE_MS = 10 * 60 * 1000;

const WAKE_WAIT_BACKOFF_MS = [5_000, 15_000, 30_000];

function backoffMs(attempt: number): number {
  return WAKE_WAIT_BACKOFF_MS[
    Math.min(attempt, WAKE_WAIT_BACKOFF_MS.length - 1)
  ]!;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WakeWaitOptions {
  onStillStarting?: () => Promise<void> | void;
  patienceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: How long a channel turn waits for an agent that is
 * still starting. Waiting is cheap because the wake returns the moment the pod
 * is ready, so each attempt's timeout is a give-up ceiling, not a poll gap.
 * Only a transient wake failure is waited on: a stopped agent, a bad image, or
 * an over-budget owner is a decision, not a delay, and fails at once.
 */
export async function runWhileAgentStarts<T>(
  run: () => Promise<T>,
  opts: WakeWaitOptions = {},
): Promise<T> {
  const patienceMs = opts.patienceMs ?? WAKE_WAIT_PATIENCE_MS;
  const sleep = opts.sleep ?? sleepMs;
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      if (
        !isAgentWakeTimeoutError(err) ||
        !isTransientWakeFailure(err.failure) ||
        Date.now() - startedAt >= patienceMs
      ) {
        throw err;
      }
      if (attempt === 0) await opts.onStillStarting?.();
      await sleep(backoffMs(attempt));
    }
  }
}
