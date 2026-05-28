import type { OutboxRepo } from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";

export interface CronSweep {
  start(): void;
  stop(): Promise<void>;
}

export interface CronSweepDeps {
  outboxRepo: OutboxRepo;
  queue: StateQueue;
  log: (msg: string) => void;
  intervalMs?: number;
  slopMs?: number;
  batchSize?: number;
}

export function createCronSweep(deps: CronSweepDeps): CronSweep {
  const intervalMs = deps.intervalMs ?? 60_000;
  const slopMs = deps.slopMs ?? 60_000;
  const batchSize = deps.batchSize ?? 100;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const stale = await deps.outboxRepo.listStale(slopMs, batchSize);
      for (const row of stale) {
        await deps.queue.enqueue(row.agentId);
      }
      if (stale.length > 0) {
        deps.log(`[runtime-sweep] re-enqueued ${stale.length} stale rows`);
      }

      const dropped = await deps.outboxRepo.deleteExpiredEvents();
      if (dropped > 0) {
        deps.log(`[runtime-sweep] dropped-expired ${dropped} events`);
      }
    } catch (err) {
      const e = err as Error & { cause?: unknown };
      const cause =
        e.cause instanceof Error ? e.cause.message : String(e.cause);
      deps.log(`[runtime-sweep] tick failed: ${e.message} | cause: ${cause}`);
    } finally {
      running = false;
    }
  }

  return {
    start(): void {
      const initial = Math.floor(Math.random() * intervalMs);
      setTimeout(() => {
        void tick();
        timer = setInterval(() => void tick(), intervalMs);
      }, initial);
    },
    async stop(): Promise<void> {
      if (timer) clearInterval(timer);
      while (running) await new Promise((r) => setTimeout(r, 50));
    },
  };
}
