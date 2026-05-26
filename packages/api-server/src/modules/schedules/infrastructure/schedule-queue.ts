import { Queue, Worker, type ConnectionOptions } from "bullmq";

export const SCHEDULES_QUEUE = "schedules";

interface ScheduleJob {
  scheduleId: string;
}

export interface ScheduleQueue {
  enqueue(scheduleId: string, fireAt: Date, now: Date): Promise<void>;
  cancel(scheduleId: string): Promise<void>;
  close(): Promise<void>;
}

export function createScheduleQueue(
  connection: ConnectionOptions,
): ScheduleQueue {
  const queue = new Queue<ScheduleJob>(SCHEDULES_QUEUE, { connection });
  return {
    async enqueue(scheduleId, fireAt, now): Promise<void> {
      await queue.remove(`schedule:${scheduleId}`).catch(() => {});
      const delayMs = Math.max(0, fireAt.getTime() - now.getTime());
      await queue.add(
        "fire",
        { scheduleId },
        {
          jobId: `schedule:${scheduleId}`,
          delay: delayMs,
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: { age: 86_400, count: 100 },
        },
      );
    },
    async cancel(scheduleId): Promise<void> {
      await queue.remove(`schedule:${scheduleId}`).catch(() => {});
    },
    async close(): Promise<void> {
      await queue.close();
    },
  };
}

export interface StartScheduleWorkerOpts {
  connection: ConnectionOptions;
  handler: (scheduleId: string) => Promise<void>;
  log: (msg: string) => void;
}

export interface RunningWorker {
  close(): Promise<void>;
}

export function startScheduleWorker(
  opts: StartScheduleWorkerOpts,
): RunningWorker {
  const worker = new Worker<ScheduleJob>(
    SCHEDULES_QUEUE,
    async (job) => opts.handler(job.data.scheduleId),
    {
      connection: opts.connection,
      concurrency: 16,
    },
  );
  worker.on("failed", (job, err) => {
    opts.log(
      `worker job ${job?.id ?? "?"} failed: ${err.message ?? String(err)}`,
    );
  });
  return {
    async close(): Promise<void> {
      await worker.close();
    },
  };
}
