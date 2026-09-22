import type { EventOutcome, PrecheckVerdict, Schedule } from "api-server-api";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../infrastructure/schedule-queue.js";
import { nextFireAt, triggerExpiry } from "../domain/recurrences.js";
import { statusForVerdict } from "../domain/status-transitions.js";
import type { AgentActivityStamp } from "../../agents/index.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { TtlStore } from "../../../core/ttl-store.js";
import { emit, EventType } from "../../../events.js";

export type ActivityStamp = AgentActivityStamp;

export type RunNowResult = "started" | "onboarding-pending";

export interface SchedulerRunner {
  buildFireHandler(): (
    scheduleId: string,
    fireAt: Date,
    lastAttempt?: boolean,
  ) => Promise<void>;
  sync(scheduleId: string): Promise<void>;
  cancel(scheduleId: string): Promise<void>;
  resetSession(scheduleId: string): Promise<void>;
  runNow(scheduleId: string): Promise<RunNowResult>;
  restoreAll(): Promise<void>;
  reportFire(input: {
    scheduleId: string;
    eventId: string;
    ranPrecheck: string;
    outcome: EventOutcome;
    detail?: string;
  }): Promise<void>;
}

export interface SchedulerRunnerDeps {
  repo: SchedulesRepository;
  queue: ScheduleQueue;
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<ActivityStamp | null>;
  restoreActivity?: (agentId: string, stamp: ActivityStamp) => Promise<void>;
  activityStamps?: TtlStore<ActivityStamp>;
  onboardingPending?: (agentId: string) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  triggerTtlSeconds?: number;
}

const VERDICT: Record<EventOutcome, PrecheckVerdict> = {
  ok: "allowed",
  declined: "declined",
  failed: "precheck-failed",
};

export function createSchedulerRunner(
  deps: SchedulerRunnerDeps,
): SchedulerRunner {
  const log = deps.log ?? ((m) => process.stderr.write(`[schedules] ${m}\n`));
  const now = deps.now ?? (() => new Date());
  const ttlSec = deps.triggerTtlSeconds ?? 3600;

  function triggerPayload(
    sched: Schedule,
    fireAt: Date,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      scheduleId: sched.id,
      task: sched.spec.task ?? "",
      fireAt: fireAt.toISOString(),
    };
    if (sched.spec.sessionMode) payload.sessionMode = sched.spec.sessionMode;
    if (sched.spec.precheck) payload.precheck = sched.spec.precheck;
    if (sched.status?.lastRun) payload.lastRunAt = sched.status.lastRun;
    return payload;
  }

  async function emitFired(
    sched: Schedule,
    outcome: "success" | "failure",
  ): Promise<void> {
    try {
      const ownerSub = await deps.repo.getOwnerById(sched.id);
      if (ownerSub) {
        emit({
          type: EventType.ScheduleFired,
          scheduleId: sched.id,
          agentId: sched.agentId,
          ownerSub,
          mode: sched.spec.sessionMode ?? "fresh",
          outcome,
        });
      }
    } catch (err) {
      log(`fire: schedule ${sched.id} emit failed: ${(err as Error).message}`);
    }
  }

  async function commitTrigger(
    sched: Schedule,
    eventId: string,
    payload: Record<string, unknown>,
    expiresAt: Date,
  ): Promise<void> {
    await deps.runtimeMutator.bump(sched.agentId, [
      { id: eventId, kind: "trigger", payload, expiresAt },
    ]);
    await deps.runtimeMutator.enqueueAfterCommit(sched.agentId);
  }

  async function pokeAgent(sched: Schedule, eventId: string): Promise<void> {
    const stamp = await deps.wakeAgent(sched.agentId);
    if (stamp && sched.spec.precheck && deps.activityStamps)
      await deps.activityStamps
        .set(eventId, stamp)
        .catch((err: Error) =>
          log(
            `fire: stamp stash failed: ${err.message}; no restore on decline`,
          ),
        );
  }

  async function deliverTrigger(
    sched: Schedule,
    eventId: string,
    payload: Record<string, unknown>,
    expiresAt: Date,
  ): Promise<void> {
    await commitTrigger(sched, eventId, payload, expiresAt);
    await pokeAgent(sched, eventId);
  }

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
    if (await deps.onboardingPending?.(sched.agentId)) {
      log(`fire: agent ${sched.agentId} has not finished onboarding; holding`);
      const after = nextFireAt(sched.spec, now());
      await deps.repo
        .recordFire(scheduleId, "held: onboarding not complete", after)
        .catch(() => {});
      if (after) await deps.queue.enqueue(scheduleId, after, now());
      return;
    }

    const eventId = `${scheduleId}:${fireAt.getTime()}`;
    const firedAt = now();
    const expiresAt = triggerExpiry(
      firedAt,
      nextFireAt(sched.spec, firedAt),
      ttlSec,
    );

    try {
      await deliverTrigger(
        sched,
        eventId,
        triggerPayload(sched, fireAt),
        expiresAt,
      );
    } catch (err) {
      const result = (err as Error).message ?? String(err);
      log(`fire: schedule ${scheduleId} failed: ${result}`);
      const after = lastAttempt ? nextFireAt(sched.spec, now()) : fireAt;
      await deps.repo.recordFire(scheduleId, result, after).catch(() => {});
      if (lastAttempt) {
        if (after) await deps.queue.enqueue(scheduleId, after, now());
        await emitFired(sched, "failure");
      }
      throw err;
    }

    const next = nextFireAt(sched.spec, now());
    if (sched.spec.precheck) await deps.repo.setNextRun(scheduleId, next);
    else await deps.repo.recordFire(scheduleId, "success", next);
    if (next) await deps.queue.enqueue(scheduleId, next, now());
    await emitFired(sched, "success");
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

    async runNow(scheduleId: string): Promise<RunNowResult> {
      const sched = await deps.repo.getById(scheduleId);
      if (!sched) throw new Error(`schedule ${scheduleId} not found`);
      if (await deps.onboardingPending?.(sched.agentId)) {
        log(
          `run-now: agent ${sched.agentId} has not finished onboarding; refusing`,
        );
        return "onboarding-pending";
      }

      const firedAt = now();
      const eventId = `run:${scheduleId}:${firedAt.getTime()}`;
      const expiresAt = new Date(firedAt.getTime() + ttlSec * 1000);

      try {
        await commitTrigger(
          sched,
          eventId,
          triggerPayload(sched, firedAt),
          expiresAt,
        );
      } catch (err) {
        log(
          `run-now: schedule ${scheduleId} commit failed: ${(err as Error).message}`,
        );
        await emitFired(sched, "failure");
        throw err;
      }

      try {
        await pokeAgent(sched, eventId);
      } catch (err) {
        const result = (err as Error).message ?? String(err);
        log(`run-now: schedule ${scheduleId} poke failed: ${result}`);
        await deps.repo.stampFire(scheduleId, result).catch(() => {});
        await emitFired(sched, "failure");
        throw err;
      }

      if (!sched.spec.precheck)
        await deps.repo.stampFire(scheduleId, "success");
      await emitFired(sched, "success");
      return "started";
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

    async reportFire(input): Promise<void> {
      const sched = await deps.repo.getById(input.scheduleId);
      if (!sched) return;
      const verdict = VERDICT[input.outcome];
      const describesCurrentPrecheck =
        sched.spec.precheck === input.ranPrecheck;
      if (describesCurrentPrecheck)
        await deps.repo.applyStatusPatch(
          input.scheduleId,
          statusForVerdict(verdict, now(), input.detail ?? "precheck failed"),
        );
      else
        log(
          `report: schedule ${input.scheduleId} changed its precheck while this one ran; verdict dropped`,
        );
      if (verdict === "declined") {
        const stamp = await deps.activityStamps?.consume(input.eventId);
        if (stamp && deps.restoreActivity)
          await deps
            .restoreActivity(sched.agentId, stamp)
            .catch((err: Error) =>
              log(`report: activity restore failed: ${err.message}`),
            );
      }
      try {
        const ownerSub = await deps.repo.getOwnerById(input.scheduleId);
        if (ownerSub)
          emit({
            type: EventType.SchedulePrecheckReported,
            scheduleId: input.scheduleId,
            agentId: sched.agentId,
            ownerSub,
          });
      } catch (err) {
        log(`report: emit failed: ${(err as Error).message}`);
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
