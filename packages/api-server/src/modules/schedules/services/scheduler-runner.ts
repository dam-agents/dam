import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../infrastructure/schedule-queue.js";
import { nextFireAt } from "../domain/recurrences.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { emit, EventType } from "../../../events.js";

export interface SchedulerRunner {
  buildFireHandler(): (scheduleId: string) => Promise<void>;
  sync(scheduleId: string): Promise<void>;
  cancel(scheduleId: string): Promise<void>;
  resetSession(scheduleId: string): Promise<void>;
  restoreAll(): Promise<void>;
}

export interface SchedulerRunnerDeps {
  repo: SchedulesRepository;
  queue: ScheduleQueue;
  runtimeMutator: RuntimeMutator;
  /** Activity poke — starts a hibernated agent's wake without waiting for Ready. */
  wakeAgent: (agentId: string) => Promise<void>;
  log?: (msg: string) => void;
  now?: () => Date;
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
    let outcome: "success" | "failure";
    try {
      await deps.runtimeMutator.bump(sched.agentId, [
        { id: eventId, kind: "trigger", payload, expiresAt },
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(sched.agentId);
      // Poke after the commit: a hibernated agent would otherwise let the
      // trigger sit in the outbox until its TTL expires. The poke doesn't
      // wait for Ready — the boot-time hello catch-up delivers the event
      // once the pod is up.
      await deps.wakeAgent(sched.agentId);
      result = "success";
      outcome = "success";
    } catch (err) {
      result = (err as Error).message ?? String(err);
      outcome = "failure";
      log(`fire: schedule ${scheduleId} failed: ${result}`);
    }

    const ownerSub = await deps.repo.getOwnerById(scheduleId);
    if (ownerSub) {
      emit({
        type: EventType.ScheduleFired,
        scheduleId,
        agentId: sched.agentId,
        ownerSub,
        mode: sched.spec.sessionMode ?? "fresh",
        sessionId: null,
        outcome,
      });
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

    // Tell the agent to clear this schedule's session binding. Durable like a
    // fire: delivered over the runtime outbox so it lands even if the pod is
    // currently scaled to zero (the agent applies it on wake).
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
        const next = nextFireAt(s.spec, now());
        await deps.repo.setNextRun(s.id, next);
        if (next) await deps.queue.enqueue(s.id, next, now());
      }
      log(`restored ${enabled.length} schedules`);
    },
  };
}
