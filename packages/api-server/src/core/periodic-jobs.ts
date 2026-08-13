import { Queue, Worker, type ConnectionOptions } from "bullmq";

export const PERIODIC_QUEUE_PREFIX = "periodic.";

export interface PeriodicJobs {
  register(
    name: string,
    everyMs: number,
    tick: () => Promise<unknown>,
  ): Promise<void>;
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
