import { formatError } from "./format-error.js";

const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P03",
]);

export function isUnreachable(err: unknown): boolean {
  for (
    let cur: unknown = err, depth = 0;
    cur !== null && typeof cur === "object" && depth < 10;
    cur = (cur as { cause?: unknown }).cause, depth++
  ) {
    const { code } = cur as { code?: unknown };
    if (typeof code === "string" && UNREACHABLE_CODES.has(code)) return true;
  }
  return false;
}

export interface RetryUnreachableOptions {
  budgetMs: number;
  delayMs: number;
  log: (msg: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs one boot step against a backing service
 * (Postgres, the object store) again while that service cannot be reached yet.
 * On a fresh install the api-server starts beside them, and in the mesh a
 * service that is not listening yet resets the connection. Without the retry
 * the process exits and the pod waits out its crash back-off. Only
 * connection-level failures are retried, and only within the budget; any other
 * error, or the last one, is thrown as it came.
 */
export async function retryWhileUnreachable<T>(
  label: string,
  step: () => Promise<T>,
  opts: RetryUnreachableOptions,
): Promise<T> {
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + opts.budgetMs;
  for (;;) {
    try {
      return await step();
    } catch (err) {
      if (!isUnreachable(err) || now() + opts.delayMs > deadline) throw err;
      opts.log(`${label}: ${formatError(err)}; retrying in ${opts.delayMs}ms`);
      await sleep(opts.delayMs);
    }
  }
}
