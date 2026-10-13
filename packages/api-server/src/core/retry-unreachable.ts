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

export function hasErrorCode(
  err: unknown,
  codes: ReadonlySet<string>,
): boolean {
  for (
    let cur: unknown = err, depth = 0;
    cur !== null && typeof cur === "object" && depth < 10;
    cur = (cur as { cause?: unknown }).cause, depth++
  ) {
    const { code } = cur as { code?: unknown };
    if (typeof code === "string" && codes.has(code)) return true;
  }
  return false;
}

export function isUnreachable(err: unknown): boolean {
  return hasErrorCode(err, UNREACHABLE_CODES);
}

export interface RetryUnreachableOptions {
  budgetMs: number;
  delayMs: number;
  maxDelayMs?: number;
  retryable?: (err: unknown) => boolean;
  log: (msg: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs one step against a service again while that
 * service cannot be reached yet: a boot step against a backing service
 * (Postgres, the object store), which on a fresh install starts beside the
 * api-server, or a proxied request to an agent pod the mesh does not route to
 * yet. In the mesh a service that is not listening yet resets the connection.
 * Only connection-level failures are retried (the caller can narrow them), and
 * only within the budget; the delay doubles up to maxDelayMs. Any other error,
 * or the last one, is thrown as it came.
 */
export async function retryWhileUnreachable<T>(
  label: string,
  step: () => Promise<T>,
  opts: RetryUnreachableOptions,
): Promise<T> {
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retryable = opts.retryable ?? isUnreachable;
  const deadline = now() + opts.budgetMs;
  for (let delayMs = opts.delayMs; ;) {
    try {
      return await step();
    } catch (err) {
      if (!retryable(err) || now() + delayMs > deadline) throw err;
      opts.log(`${label}: ${formatError(err)}; retrying in ${delayMs}ms`);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, opts.maxDelayMs ?? opts.delayMs);
    }
  }
}
