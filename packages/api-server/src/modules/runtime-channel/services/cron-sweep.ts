import type { RuntimeChannelQueues } from "../infrastructure/bullmq-queue.js";
import type { StateOutboxRepository } from "../infrastructure/state-outbox-repository.js";
import type { SignalOutboxRepository } from "../infrastructure/signal-outbox-repository.js";

export interface CronSweep {
  start(): void;
  stop(): Promise<void>;
}

export interface CronSweepDeps {
  stateRepo: StateOutboxRepository;
  signalRepo: SignalOutboxRepository;
  queues: RuntimeChannelQueues;
  /** Cadence and freshness window. Outbox rows whose enqueue is older
   *  than `intervalMs` AND have not been acknowledged are re-enqueued.
   *  Setting `intervalMs` short enough to cover BullMQ retry exhaustion
   *  windows is the load-bearing design knob — defaults to 1 minute. */
  intervalMs?: number;
  staleMs?: number;
  batchSize?: number;
  log?: (msg: string) => void;
}

export function createCronSweep(deps: CronSweepDeps): CronSweep {
  const intervalMs = deps.intervalMs ?? 60_000;
  const staleMs = deps.staleMs ?? 60_000;
  const batchSize = deps.batchSize ?? 200;
  const log = deps.log ?? (() => {});
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const olderThan = new Date(now.getTime() - staleMs);

      const droppedSignals = await deps.signalRepo.deleteExpired(
        now,
        batchSize,
      );
      if (droppedSignals.length) {
        log(`[runtime-channel:sweep] expired ${droppedSignals.length} signals`);
      }

      const staleStates = await deps.stateRepo.listStale({
        olderThan,
        limit: batchSize,
      });
      for (const row of staleStates) {
        if (
          row.lastAppliedAt &&
          row.lastAppliedAt.getTime() >= row.enqueuedAt.getTime()
        ) {
          continue;
        }
        await deps.queues.enqueueState({
          agentId: row.agentId,
          version: row.version,
        });
      }
      if (staleStates.length) {
        log(`[runtime-channel:sweep] re-enqueued ${staleStates.length} states`);
      }

      const stalePending = await deps.signalRepo.listPending({
        now,
        limit: batchSize,
      });
      for (const row of stalePending) {
        if (now.getTime() - row.enqueuedAt.getTime() < staleMs) continue;
        await deps.queues.enqueueSignal({ signalId: row.id });
      }
    } catch (e) {
      log(`[runtime-channel:sweep] error: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), intervalMs);
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
