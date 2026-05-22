import { Queue, Worker, type Processor, type RedisOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";

/** Two queues so the BullMQ dashboard and metrics distinguish state
 *  deliveries (one row per agent, dedup'd by stable job id) from signal
 *  deliveries (one job per discrete event). They share the same Redis
 *  connection. */
export const STATE_QUEUE_NAME = "runtime-channel-state";
export const SIGNAL_QUEUE_NAME = "runtime-channel-signal";

export interface StateJobData {
  agentId: string;
  /** The version we expect to deliver. The processor still reads the
   *  current row from Postgres before dispatch — the version on the
   *  job is only a stable identity for the dedupe job id. */
  version: string;
}

export interface SignalJobData {
  signalId: string;
}

export interface RuntimeChannelQueues {
  state: Queue<StateJobData>;
  signal: Queue<SignalJobData>;
  /** Idempotent. Existing job ids are rejected by BullMQ, which is the
   *  natural coalescing path for state deliveries — a flurry of
   *  mutations affecting the same agent merges into one delivery. */
  enqueueState(input: StateJobData): Promise<void>;
  enqueueSignal(input: SignalJobData): Promise<void>;
  startStateWorker(processor: Processor<StateJobData>): Worker<StateJobData>;
  startSignalWorker(processor: Processor<SignalJobData>): Worker<SignalJobData>;
  close(): Promise<void>;
}

export interface RuntimeChannelQueuesOptions {
  redisUrl: string;
  redisPassword?: string;
  /** BullMQ Worker concurrency — how many jobs per replica run in
   *  parallel. Each job is a tRPC call to one agent pod; the agent
   *  serializes apply on its side, so a modest number across all
   *  replicas is fine. */
  concurrency?: number;
}

function buildRedis(opts: RuntimeChannelQueuesOptions): RedisOptions {
  const url = new URL(opts.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: opts.redisPassword || undefined,
    /** BullMQ requires this on blocking connections; ioredis throws if
     *  set elsewhere, so the queue/worker pair owns its own connection
     *  shape and does not share the existing pub/sub `RedisBus` pair. */
    maxRetriesPerRequest: null,
  };
}

export function createRuntimeChannelQueues(
  opts: RuntimeChannelQueuesOptions,
): RuntimeChannelQueues {
  const connection = buildRedis(opts);
  const concurrency = opts.concurrency ?? 4;

  const state = new Queue<StateJobData>(STATE_QUEUE_NAME, { connection });
  const signal = new Queue<SignalJobData>(SIGNAL_QUEUE_NAME, { connection });

  const workers: Worker<unknown>[] = [];
  const redisConns: Redis[] = [];

  return {
    state,
    signal,

    async enqueueState(input) {
      await state.add(`state:${input.agentId}`, input, {
        jobId: `state:${input.agentId}`,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
        /** Transport failures only — the cron sweep covers the
         *  hibernated-agent case via re-enqueue. */
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      });
    },

    async enqueueSignal(input) {
      await signal.add(`signal:${input.signalId}`, input, {
        jobId: `signal:${input.signalId}`,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
      });
    },

    startStateWorker(processor) {
      const w = new Worker<StateJobData>(STATE_QUEUE_NAME, processor, {
        connection,
        concurrency,
      });
      workers.push(w as Worker<unknown>);
      return w;
    },

    startSignalWorker(processor) {
      const w = new Worker<SignalJobData>(SIGNAL_QUEUE_NAME, processor, {
        connection,
        concurrency,
      });
      workers.push(w as Worker<unknown>);
      return w;
    },

    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await state.close();
      await signal.close();
      for (const r of redisConns) await r.quit();
    },
  };
}

/** Cron-style sweep clock. Used by the `cron-sweep` service to schedule
 *  itself via BullMQ's repeat options without standing up node-cron. */
export function buildSweepRepeatOptions(intervalMs: number) {
  return { every: intervalMs };
}

/** Direct ioredis connection — exposed for things that need raw Redis
 *  (e.g., the existing RedisBus). Not used by the worker. */
export function createRedisConnection(
  opts: RuntimeChannelQueuesOptions,
): Redis {
  const url = new URL(opts.redisUrl);
  return new IORedis(
    Number(url.port) || 6379,
    url.hostname,
    opts.redisPassword ? { password: opts.redisPassword } : {},
  );
}
