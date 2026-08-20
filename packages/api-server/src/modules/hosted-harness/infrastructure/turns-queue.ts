import { Queue, Worker, type ConnectionOptions } from "bullmq";

export const HOSTED_TURNS_QUEUE = "hosted-turns";

export interface TurnJob {
  turnId: string;
}

export interface TurnsQueue {
  enqueue(turnId: string): Promise<void>;
  close(): Promise<void>;
}

export function createTurnsQueue(connection: ConnectionOptions): TurnsQueue {
  const queue = new Queue<TurnJob>(HOSTED_TURNS_QUEUE, { connection });
  return {
    async enqueue(turnId): Promise<void> {
      await queue.add(
        "turn",
        { turnId },
        {
          jobId: turnId,
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

export interface StartTurnWorkerOpts {
  connection: ConnectionOptions;
  handler: (turnId: string) => Promise<void>;
  log: (msg: string) => void;
  concurrency?: number;
}

export interface RunningTurnWorker {
  close(): Promise<void>;
}

export function startTurnWorker(opts: StartTurnWorkerOpts): RunningTurnWorker {
  const worker = new Worker<TurnJob>(
    HOSTED_TURNS_QUEUE,
    async (job) => opts.handler(job.data.turnId),
    {
      connection: opts.connection,
      concurrency: opts.concurrency ?? 64,
      lockDuration: 60_000,
      maxStalledCount: 10,
    },
  );
  worker.on("failed", (job, err) => {
    opts.log(
      `[hosted-turns] job ${job?.id ?? "?"} failed: ${err.message ?? String(err)}`,
    );
  });
  return {
    async close(): Promise<void> {
      await worker.close();
    },
  };
}
