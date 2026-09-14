import type { ScheduleFireReportInput } from "api-server-api";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../infrastructure/schedule-queue.js";
import { nextFireAt, triggerExpiry } from "../domain/recurrences.js";
import type { AgentActivityStamp } from "../../agents/index.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { TtlStore } from "../../../core/ttl-store.js";
import { emit, EventType } from "../../../events.js";

export type ActivityStamp = AgentActivityStamp;

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
  reportFire(agentId: string, input: ScheduleFireReportInput): Promise<void>;
}

export interface SchedulerRunnerDeps {
  repo: SchedulesRepository;
  queue: ScheduleQueue;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<ActivityStamp | null>;
  restoreActivity?: (agentId: string, stamp: ActivityStamp) => Promise<void>;
  activityStamps?: TtlStore<ActivityStamp>;
  log?: (msg: string) => void;
  now?: () => Date;
  triggerTtlSeconds?: number;
}

function stampKey(scheduleId: string, fireAt: Date): string {
  return `${scheduleId}:${fireAt.getTime()}`;
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
      fireAt: fireAt.toISOString(),
    };
    if (sched.spec.sessionMode) payload.sessionMode = sched.spec.sessionMode;
    if (sched.spec.precheck) payload.precheck = sched.spec.precheck;
    if (sched.status?.lastRun) payload.lastRunAt = sched.status.lastRun;

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
      const stamp = await deps.wakeAgent(sched.agentId);
      if (stamp && sched.spec.precheck && deps.activityStamps)
        await deps.activityStamps
          .set(stampKey(scheduleId, fireAt), stamp)
          .catch(() => {});
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

    async reportFire(agentId, input): Promise<void> {
      const sched = await deps.repo.getById(input.scheduleId);
      if (!sched || sched.agentId !== agentId) return;
      switch (input.verdict) {
        case "allowed":
          await deps.repo.recordPrecheckError(input.scheduleId, null);
          return;
        case "precheck-failed":
          await deps.repo.recordPrecheckError(
            input.scheduleId,
            input.detail ?? "precheck failed",
          );
          return;
        case "declined": {
          await deps.repo.recordDecline(input.scheduleId, now());
          const key = stampKey(input.scheduleId, new Date(input.fireAt));
          const stamp = await deps.activityStamps?.consume(key);
          if (stamp && deps.restoreActivity)
            await deps.restoreActivity(agentId, stamp).catch((err: Error) => {
              log(`report: activity restore failed: ${err.message}`);
            });
          return;
        }
      }
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
