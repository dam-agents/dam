export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  jitter?: number;
  random?: () => number;
}

export interface Backoff {
  next(): number;
  reset(): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: How long a worker waits before it tries the
 * platform again. Capped exponential with jitter, because many machines started
 * at once come back at once when the platform returns, and the shared
 * terminal-reconnect ladder has no jitter to spread them out. `next` grows the
 * wait from the base to the cap and never past it, so a machine that is offline
 * for a week still says so once every cap.
 */
export function createBackoff(options: BackoffOptions = {}): Backoff {
  const { baseMs = 1_000, capMs = 30_000, jitter = 0.2 } = options;
  const random = options.random ?? Math.random;
  let attempt = 0;
  return {
    next() {
      const capped = Math.min(baseMs * 2 ** attempt, capMs);
      attempt += 1;
      const spread = capped * jitter;
      return Math.round(capped - spread + 2 * spread * random());
    },
    reset() {
      attempt = 0;
    },
  };
}
