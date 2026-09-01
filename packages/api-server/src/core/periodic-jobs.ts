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

const RESCHEDULE_EVERY_MS = 10 * 60 * 1000;

export function createPeriodicJobs(opts: {
  connection: ConnectionOptions;
  log: (msg: string) => void;
}): PeriodicJobs {
  const queues: Queue[] = [];
  const workers: Worker[] = [];
  let started = false;

  const upsert = (queue: Queue, name: string, everyMs: number) =>
    queue.upsertJobScheduler(
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

  const reupserts: (() => Promise<unknown>)[] = [];
  const rescheduler = setInterval(() => {
    for (const reupsert of reupserts) {
      void reupsert().catch((err) =>
        opts.log(`scheduler re-upsert failed: ${err}`),
      );
    }
  }, RESCHEDULE_EVERY_MS);
  rescheduler.unref?.();

  return {
    async register(name, everyMs, tick) {
      const queueName = `${PERIODIC_QUEUE_PREFIX}${name}`;
      const queue = new Queue(queueName, { connection: opts.connection });
      queues.push(queue);
      await upsert(queue, name, everyMs);
      reupserts.push(() => upsert(queue, name, everyMs));
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
      clearInterval(rescheduler);
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(queues.map((q) => q.close()));
    },
  };
}
