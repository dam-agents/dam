import {
  DEFAULT_MAX_APPLY_ATTEMPTS,
  type OutboxRepo,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";
import type { IsAgentRunning } from "./worker-handler.js";

export interface CronSweep {
  tick(): Promise<void>;
}

export interface CronSweepDeps {
  outboxRepo: OutboxRepo;
  queue: StateQueue;
  agentRunningPort: IsAgentRunning;
  log: (msg: string) => void;
  maxApplyAttempts?: number;
  batchSize?: number;
}

export function createCronSweep(deps: CronSweepDeps): CronSweep {
  const maxApplyAttempts = deps.maxApplyAttempts ?? DEFAULT_MAX_APPLY_ATTEMPTS;
  const batchSize = deps.batchSize ?? 100;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const retryable = await deps.outboxRepo.listRetryable(
        maxApplyAttempts,
        batchSize,
      );
      const live = await Promise.all(
        retryable.map((row) =>
          deps.agentRunningPort.isRunning(row.agentId).catch(() => false),
        ),
      );
      const enqueue = retryable.filter((_, i) => live[i]);
      const skipped = retryable.length - enqueue.length;
      for (const row of enqueue) {
        await deps.queue.enqueue(row.agentId);
      }
      if (enqueue.length > 0) {
        deps.log(`[runtime-sweep] re-enqueued ${enqueue.length} pending rows`);
      }
      if (skipped > 0) {
        deps.log(
          `[runtime-sweep] skipped ${skipped} pending rows for stopped agents (hello re-enqueues on wake)`,
        );
      }

      const dropped = await deps.outboxRepo.deleteExpiredEvents();
      if (dropped > 0) {
        deps.log(`[runtime-sweep] dropped-expired ${dropped} events`);
      }
    } catch (err) {
      const e = err as Error & { cause?: unknown };
      const cause =
        e.cause instanceof Error ? e.cause.message : String(e.cause);
      deps.log(`[runtime-sweep] tick failed: ${e.message} | cause: ${cause}`);
    } finally {
      running = false;
    }
  }

  return { tick };
}
