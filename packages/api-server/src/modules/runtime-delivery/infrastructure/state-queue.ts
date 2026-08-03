import { Queue, Worker, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

export const RUNTIME_STATE_QUEUE = "runtime-state";

export interface StateJob {
  agentId: string;
  /** Set by `hello`: fast-retry on the queue backoff if not yet Ready, instead of deferring to the sweep. */
  retryUntilReady?: boolean;
}

export interface StateQueue {
  enqueue(agentId: string, opts?: { retryUntilReady?: boolean }): Promise<void>;
  close(): Promise<void>;
}

// `retryUntilReady` jobs wait on the Ready condition: re-check on a tight fixed cadence (~wake budget) so the apply lands seconds after Ready, not at the next sparse exponential retry.
const READY_RECHECK_MS = 1_000;
const READY_RECHECK_ATTEMPTS = 120;

export function createStateQueue(connection: ConnectionOptions): StateQueue {
  const queue = new Queue<StateJob>(RUNTIME_STATE_QUEUE, { connection });
  return {
    async enqueue(agentId, opts): Promise<void> {
      // No jobId dedup on purpose: applyState is idempotent, so a prompt redundant apply beats stalling fresh config behind an in-flight job.
      const retry = opts?.retryUntilReady
        ? {
            attempts: READY_RECHECK_ATTEMPTS,
            backoff: { type: "fixed" as const, delay: READY_RECHECK_MS },
          }
        : {
            attempts: 8,
            backoff: { type: "exponential" as const, delay: 1_000 },
          };
      await queue.add(
        "state",
        { agentId, retryUntilReady: opts?.retryUntilReady },
        {
          ...retry,
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
  handler: (
    agentId: string,
    opts?: { retryUntilReady?: boolean },
  ) => Promise<void>;
  log: (msg: string) => void;
}

export interface RunningWorker {
  close(): Promise<void>;
}

export function startStateWorker(opts: StartWorkerOpts): RunningWorker {
  const worker = new Worker<StateJob>(
    RUNTIME_STATE_QUEUE,
    async (job) =>
      opts.handler(job.data.agentId, {
        retryUntilReady: job.data.retryUntilReady,
      }),
    {
      connection: opts.connection,
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
