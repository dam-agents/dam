import type { Db } from "db";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../infrastructure/schedule-queue.js";
import { nextFireAt } from "../domain/recurrences.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";

/**
 * Self-rescheduling scheduler runner (ADR-053). Pure orchestration — the
 * BullMQ transport lives in `infrastructure/schedule-queue.ts`.
 *
 * Each schedule maps to at most one pending delayed job; on fire the
 * runner:
 *   1. Re-reads the schedule from Postgres (handles concurrent edits).
 *   2. If still enabled: inserts a `runtime_events` row + bumps the
 *      agent's outbox + enqueues runtime-state delivery.
 *   3. Records the fire and enqueues the next occurrence.
 *
 * Schedule CRUD calls `sync(id)` to replace the pending job — single
 * entry point for all repeatable-mutation concerns.
 */
export interface SchedulerRunner {
  /** Build the fire-handler that the queue worker invokes. The handler
   *  is owner-agnostic: authority comes from "this schedule fired". */
  buildFireHandler(): (scheduleId: string) => Promise<void>;
  /** Register a delayed job for a schedule's next occurrence. Replaces
   *  any existing pending job for the same id. */
  sync(scheduleId: string): Promise<void>;
  /** Cancel any pending job for this schedule. */
  cancel(scheduleId: string): Promise<void>;
  /** Replay every enabled schedule from Postgres into BullMQ on boot. */
  restoreAll(): Promise<void>;
}

export interface SchedulerRunnerDeps {
  repo: SchedulesRepository;
  queue: ScheduleQueue;
  db: Db;
  runtimeMutator: RuntimeMutator;
  log?: (msg: string) => void;
  now?: () => Date;
  /** TTL for a fired trigger event (seconds). The state-builder drops
   *  events past this. */
  triggerTtlSeconds?: number;
}

export function createSchedulerRunner(
  deps: SchedulerRunnerDeps,
): SchedulerRunner {
  const log = deps.log ?? ((m) => process.stderr.write(`[schedules] ${m}\n`));
  const now = deps.now ?? (() => new Date());
  const ttlSec = deps.triggerTtlSeconds ?? 3600;

  async function fire(scheduleId: string): Promise<void> {
    const sched = await deps.repo.getById(scheduleId);
    if (!sched) {
      log(`fire: schedule ${scheduleId} not found; dropping`);
      return;
    }
    if (!sched.spec.enabled) {
      log(`fire: schedule ${scheduleId} disabled; dropping`);
      return;
    }

    const eventId = `${scheduleId}:${now().getTime()}`;
    const expiresAt = new Date(now().getTime() + ttlSec * 1000);
    const payload: Record<string, unknown> = {
      scheduleId,
      task: sched.spec.task ?? "",
    };
    if (sched.spec.sessionMode) payload.sessionMode = sched.spec.sessionMode;

    let result: string;
    try {
      await deps.db.transaction(async (tx) => {
        await deps.runtimeMutator.commitInTx(
          tx as unknown as Db,
          sched.agentId,
          [{ id: eventId, kind: "trigger", payload, expiresAt }],
        );
      });
      await deps.runtimeMutator.enqueueAfterCommit(sched.agentId);
      result = "success";
    } catch (err) {
      result = (err as Error).message ?? String(err);
      log(`fire: schedule ${scheduleId} commit failed: ${result}`);
    }

    const next = nextFireAt(sched.spec, now());
    await deps.repo.recordFire(scheduleId, result, next);
    if (next) await deps.queue.enqueue(scheduleId, next, now());
  }

  return {
    buildFireHandler: () => fire,

    async sync(scheduleId: string): Promise<void> {
      const sched = await deps.repo.getById(scheduleId);
      if (!sched || !sched.spec.enabled) {
        await deps.queue.cancel(scheduleId);
        await deps.repo.setNextRun(scheduleId, null);
        return;
      }
      const next = nextFireAt(sched.spec, now());
      await deps.repo.setNextRun(scheduleId, next);
      if (next) await deps.queue.enqueue(scheduleId, next, now());
      else await deps.queue.cancel(scheduleId);
    },

    async cancel(scheduleId: string): Promise<void> {
      await deps.queue.cancel(scheduleId);
      await deps.repo.setNextRun(scheduleId, null);
    },

    async restoreAll(): Promise<void> {
      const enabled = await deps.repo.listAllEnabled();
      for (const s of enabled) {
        const next = nextFireAt(s.spec, now());
        await deps.repo.setNextRun(s.id, next);
        if (next) await deps.queue.enqueue(s.id, next, now());
      }
      log(`restored ${enabled.length} schedules`);
    },
  };
}
