import { Queue, Worker, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

/**
 * BullMQ queue + worker for the runtime-channel delivery rail (ADR-053).
 *
 * Single queue `runtime-state`, one job kind, stable jobId per agent
 * (`state-<agentId>`) so a flurry of mutations on the same agent coalesces
 * to one dispatch — BullMQ rejects re-adds of an already-pending id.
 * The separator is `-`, not `:`: BullMQ ≥ 5.76 rejects custom ids
 * containing `:` (it clashes with Redis's namespace separator).
 *
 * The platform's Redis is intentionally configured for relaxed durability
 * (ADR-036). Postgres' `runtime_state_outbox` is the source of truth; the
 * cron sweep re-enqueues anything BullMQ drops.
 */

export const RUNTIME_STATE_QUEUE = "runtime-state";

export interface StateJob {
  agentId: string;
}

export interface StateQueue {
  enqueue(agentId: string): Promise<void>;
  close(): Promise<void>;
}

export function createStateQueue(connection: ConnectionOptions): StateQueue {
  const queue = new Queue<StateJob>(RUNTIME_STATE_QUEUE, { connection });
  return {
    async enqueue(agentId): Promise<void> {
      await queue.add(
        "state",
        { agentId },
        {
          // Stable id → natural coalescing. BullMQ rejects re-adds while a
          // job with this id is pending or active.
          jobId: `state-${agentId}`,
          // Exponential backoff for transport failures. The handler's
          // own logic exits clean on "agent not running"; only thrown
          // errors trigger retries.
          attempts: 8,
          backoff: { type: "exponential", delay: 1_000 },
          // Trim completed/failed jobs so the queue doesn't grow unbounded.
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86_400, count: 1000 },
        },
      );
    },
    async close(): Promise<void> {
      await queue.close();
    },
  };
}

export interface StartWorkerOpts {
  connection: ConnectionOptions;
  handler: (agentId: string) => Promise<void>;
  log: (msg: string) => void;
}

export interface RunningWorker {
  close(): Promise<void>;
}

export function startStateWorker(opts: StartWorkerOpts): RunningWorker {
  const worker = new Worker<StateJob>(
    RUNTIME_STATE_QUEUE,
    async (job) => opts.handler(job.data.agentId),
    {
      connection: opts.connection,
      // Per-replica concurrency. The work itself is one DB read + one HTTP
      // round-trip + one DB write — IO bound, not CPU. 16 is conservative.
      concurrency: 16,
    },
  );
  worker.on("failed", (job, err) => {
    opts.log(
      `[runtime-worker] job ${job?.id ?? "?"} failed: ${err.message ?? String(err)}`,
    );
  });
  return {
    async close(): Promise<void> {
      await worker.close();
    },
  };
}

/**
 * BullMQ takes its own ioredis connection. We use a dedicated client (not
 * the shared bus) because BullMQ's worker holds a blocking BRPOPLPUSH on
 * its connection; mixing pub/sub on the same connection breaks both.
 */
export function createBullConnection(
  url: string,
  password?: string,
): ConnectionOptions {
  return new IORedis(url, {
    password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
