import { Queue, Worker, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

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
      // No jobId dedup on purpose: applyState is idempotent, so a prompt redundant apply beats stalling fresh config behind an in-flight job.
      await queue.add(
        "state",
        { agentId },
        {
          attempts: 8,
          backoff: { type: "exponential", delay: 1_000 },
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
