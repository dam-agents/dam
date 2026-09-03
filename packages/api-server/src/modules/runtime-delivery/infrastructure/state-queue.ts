import {
  Queue,
  Worker,
  type ConnectionOptions,
  type JobsOptions,
} from "bullmq";
import IORedis from "ioredis";

export const RUNTIME_STATE_QUEUE = "runtime-state";

export interface StateJob {
  agentId: string;
  retryUntilReady?: boolean;
}

export interface StateQueue {
  enqueue(agentId: string, opts?: { retryUntilReady?: boolean }): Promise<void>;
  enqueueMany(agentIds: string[]): Promise<void>;
  close(): Promise<void>;
}

const READY_RECHECK_MS = 1_000;
const READY_RECHECK_ATTEMPTS = 120;

export function stateJobOptions(
  agentId: string,
  opts?: { retryUntilReady?: boolean },
): JobsOptions {
  const boot = opts?.retryUntilReady === true;
  const retry = boot
    ? {
        attempts: READY_RECHECK_ATTEMPTS,
        backoff: { type: "fixed" as const, delay: READY_RECHECK_MS },
      }
    : {
        attempts: 8,
        backoff: { type: "exponential" as const, delay: 1_000 },
      };
  return {
    ...retry,
    deduplication: {
      id: boot ? `${agentId}:boot` : agentId,
      keepLastIfActive: true,
    },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86_400, count: 1000 },
  };
}

export function createStateQueue(connection: ConnectionOptions): StateQueue {
  const queue = new Queue<StateJob>(RUNTIME_STATE_QUEUE, { connection });
  return {
    async enqueue(agentId, opts): Promise<void> {
      await queue.add(
        "state",
        { agentId, retryUntilReady: opts?.retryUntilReady },
        stateJobOptions(agentId, opts),
      );
    },
    async enqueueMany(agentIds): Promise<void> {
      if (agentIds.length === 0) return;
      await queue.addBulk(
        agentIds.map((agentId) => ({
          name: "state",
          data: { agentId },
          opts: stateJobOptions(agentId),
        })),
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
  concurrency: number;
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
      concurrency: opts.concurrency,
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
