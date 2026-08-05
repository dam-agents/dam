import { Queue, Worker, type ConnectionOptions } from "bullmq";

/**
 * Platform-wide home for periodic background work: every recurring
 * reconciliation tick (sweeps, refresh loops) runs as a BullMQ job scheduler
 * instead of a per-replica interval loop, so each period executes once
 * across the deployment. Each registered job gets its OWN queue
 * (`periodic.<name>` — BullMQ forbids `:` in queue names) and its own
 * single-concurrency worker — a hung or slow
 * tick can only stall its own lane (its backlog shows up as queue depth),
 * never another job's. The queue provides scheduling and visibility, never
 * correctness — ticks must stay idempotent and safe under at-least-once
 * execution. A retired job leaves its queue behind in Redis; remove it
 * manually (`bull:periodic.<name>:*`) when the job is deleted for good.
 */
export const PERIODIC_QUEUE_PREFIX = "periodic.";

export interface PeriodicJobs {
  /** Register a named periodic job. Upserting is idempotent across replicas
   *  and interval changes replace the previous schedule (no stale repeat
   *  keys). A job registered after `start()` begins processing immediately. */
  register(
    name: string,
    everyMs: number,
    tick: () => Promise<unknown>,
  ): Promise<void>;
  /** Start processing registered jobs. */
  start(): void;
  close(): Promise<void>;
}

export function createPeriodicJobs(opts: {
  connection: ConnectionOptions;
  log: (msg: string) => void;
}): PeriodicJobs {
  const queues: Queue[] = [];
  const workers: Worker[] = [];
  let started = false;

  return {
    async register(name, everyMs, tick) {
      const queueName = `${PERIODIC_QUEUE_PREFIX}${name}`;
      const queue = new Queue(queueName, { connection: opts.connection });
      queues.push(queue);
      await queue.upsertJobScheduler(
        name,
        { every: everyMs },
        {
          name,
          opts: {
            removeOnComplete: { age: 3600, count: 24 },
            removeOnFail: { age: 86_400, count: 50 },
          },
        },
      );
      const worker = new Worker(queueName, async () => tick(), {
        connection: opts.connection,
        concurrency: 1,
        autorun: false,
      });
      worker.on("failed", (_job, err) => {
        opts.log(`periodic job ${name} failed: ${err.message}`);
      });
      workers.push(worker);
      if (started) void worker.run();
    },

    start() {
      started = true;
      for (const worker of workers) void worker.run();
    },

    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(queues.map((q) => q.close()));
    },
  };
}
