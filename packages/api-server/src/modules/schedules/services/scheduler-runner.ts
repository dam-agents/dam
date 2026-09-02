import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../infrastructure/schedule-queue.js";
import { nextFireAt } from "../domain/recurrences.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { emit, EventType } from "../../../events.js";

export interface SchedulerRunner {
  buildFireHandler(): (
    scheduleId: string,
    fireAt: Date,
    lastAttempt?: boolean,
  ) => Promise<void>;
  sync(scheduleId: string): Promise<void>;
  cancel(scheduleId: string): Promise<void>;
  resetSession(scheduleId: string): Promise<void>;
  restoreAll(): Promise<void>;
}

export interface SchedulerRunnerDeps {
  repo: SchedulesRepository;
  queue: ScheduleQueue;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  log?: (msg: string) => void;
  now?: () => Date;
  triggerTtlSeconds?: number;
}

function triggerExpiry(firedAt: Date, next: Date | null, ttlSec: number): Date {
  const byTtl = firedAt.getTime() + ttlSec * 1000;
  const byNext = next?.getTime() ?? Infinity;
  return new Date(byNext > firedAt.getTime() ? Math.min(byTtl, byNext) : byTtl);
}

export function createSchedulerRunner(
  deps: SchedulerRunnerDeps,
): SchedulerRunner {
  const log = deps.log ?? ((m) => process.stderr.write(`[schedules] ${m}\n`));
  const now = deps.now ?? (() => new Date());
  const ttlSec = deps.triggerTtlSeconds ?? 3600;

  async function fire(
    scheduleId: string,
    fireAt: Date,
    lastAttempt = true,
  ): Promise<void> {
    const sched = await deps.repo.getById(scheduleId);
    if (!sched) {
      log(`fire: schedule ${scheduleId} not found; dropping`);
      return;
    }
    if (!sched.spec.enabled) {
      log(`fire: schedule ${scheduleId} disabled; dropping`);
      return;
    }

    const eventId = `${scheduleId}:${fireAt.getTime()}`;
    const firedAt = now();
    const expiresAt = triggerExpiry(
      firedAt,
      nextFireAt(sched.spec, firedAt),
      ttlSec,
    );
    const payload: Record<string, unknown> = {
      scheduleId,
      task: sched.spec.task ?? "",
    };
    if (sched.spec.sessionMode) payload.sessionMode = sched.spec.sessionMode;

    const emitFired = async (outcome: "success" | "failure") => {
      try {
        const ownerSub = await deps.repo.getOwnerById(scheduleId);
        if (ownerSub) {
          emit({
            type: EventType.ScheduleFired,
            scheduleId,
            agentId: sched.agentId,
            ownerSub,
            mode: sched.spec.sessionMode ?? "fresh",
            outcome,
          });
        }
      } catch (err) {
        log(
          `fire: schedule ${scheduleId} emit failed: ${(err as Error).message}`,
        );
      }
    };

    try {
      await deps.runtimeMutator.bump(sched.agentId, [
        { id: eventId, kind: "trigger", payload, expiresAt },
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(sched.agentId);
      await deps.wakeAgent(sched.agentId);
    } catch (err) {
      const result = (err as Error).message ?? String(err);
      log(`fire: schedule ${scheduleId} failed: ${result}`);
      const after = lastAttempt ? nextFireAt(sched.spec, now()) : fireAt;
      await deps.repo.recordFire(scheduleId, result, after).catch(() => {});
      if (lastAttempt) {
        if (after) await deps.queue.enqueue(scheduleId, after, now());
        await emitFired("failure");
      }
      throw err;
    }

    const next = nextFireAt(sched.spec, now());
    await deps.repo.recordFire(scheduleId, "success", next);
    if (next) await deps.queue.enqueue(scheduleId, next, now());
    await emitFired("success");
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

    async resetSession(scheduleId: string): Promise<void> {
      const sched = await deps.repo.getById(scheduleId);
      if (!sched) return;
      const eventId = `reset:${scheduleId}:${now().getTime()}`;
      const expiresAt = new Date(now().getTime() + ttlSec * 1000);
      await deps.runtimeMutator.bump(sched.agentId, [
        {
          id: eventId,
          kind: "schedule-reset",
          payload: { scheduleId },
          expiresAt,
        },
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(sched.agentId);
    },

    async restoreAll(): Promise<void> {
      const enabled = await deps.repo.listAllEnabled();
      for (const s of enabled) {
        const stored = s.status?.nextRun ? new Date(s.status.nextRun) : null;
        const next = stored ?? nextFireAt(s.spec, now());
        if (!stored) await deps.repo.setNextRun(s.id, next);
        if (next) await deps.queue.ensure(s.id, next, now());
      }
      log(`restored ${enabled.length} schedules`);
    },
  };
}
