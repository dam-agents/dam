import { formatError } from "../../../core/format-error.js";
import { retryWhileUnreachable } from "../../../core/retry-unreachable.js";

const FIRST_DELAY_MS = 2_000;
const MAX_DELAY_MS = 30_000;

export interface ProvisionBucketOptions {
  retryable: (err: unknown) => boolean;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Provisions the artifacts bucket without holding
 * the boot. The object store can be down for minutes while a node drains, and
 * most of the api-server (Agents, Sessions, schedules) never touches it, so a
 * replica that starts in that window serves at once and keeps trying here,
 * with no budget, while `retryable` says the store is not serving yet. Any
 * other failure, such as refused credentials, is logged once and not
 * retried. The promise never rejects.
 */
export async function provisionBucketInBackground(
  ensureReady: () => Promise<void>,
  opts: ProvisionBucketOptions,
): Promise<void> {
  try {
    await retryWhileUnreachable("object storage", ensureReady, {
      budgetMs: Number.POSITIVE_INFINITY,
      delayMs: FIRST_DELAY_MS,
      maxDelayMs: MAX_DELAY_MS,
      retryable: opts.retryable,
      log: opts.log.warn,
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
    opts.log.info("object storage: the bucket is ready");
  } catch (err) {
    opts.log.error(
      `object storage: the bucket could not be provisioned (${formatError(err)}); features that store files fail until this is fixed`,
    );
  }
}
