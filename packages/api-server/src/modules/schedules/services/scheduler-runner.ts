import { match } from "ts-pattern";
import { OnceResult } from "api-server-api";
import type {
  EventOutcome,
  EventStage,
  PrecheckVerdict,
  Schedule,
  ScheduleSpecOnce,
} from "api-server-api";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../infrastructure/schedule-queue.js";
import { nextFireAt, triggerExpiry } from "../domain/recurrences.js";
import { onceFireAction, onceFireAt } from "../domain/once.js";
import { statusForVerdict } from "../domain/status-transitions.js";
import type { AgentActivityStamp } from "../../agents/index.js";
import type {
  EventLifecycleTransition,
  RuntimeMutator,
} from "../../runtime-delivery/index.js";
import type { TtlStore } from "../../../core/ttl-store.js";
import { emit, EventType } from "../../../events.js";

const TRIGGER_TTL_SECONDS = 3600;

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
  recordDelivery(
    scheduleId: string,
    transition: EventLifecycleTransition,
  ): Promise<void>;
  recordOnceFailure(scheduleId: string, reason: string): Promise<void>;
  reportFire(input: {
    scheduleId: string;
    eventId: string;
    ranPrecheck: string | null;
    outcome: EventOutcome;
    stage?: EventStage;
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
  runtimeMigrating?: (agentId: string) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
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

  const upcoming = (sched: Schedule): Date | null =>
    match(sched.spec)
      .with({ type: "once" }, (spec) => onceFireAt(spec, sched.status, now()))
      .with({ type: "cron" }, { type: "rrule" }, (spec) =>
        nextFireAt(spec, now()),
      )
      .exhaustive();

  const emitChanged = async (
    agentId: string,
    scheduleId: string,
  ): Promise<void> => {
    try {
      const ownerSub = await deps.repo.getOwnerById(scheduleId);
      if (ownerSub)
        emit({
          type: EventType.ScheduleUpdated,
          scheduleId,
          agentId,
          ownerSub,
        });
    } catch (err) {
      log(`schedule ${scheduleId} emit failed: ${(err as Error).message}`);
    }
  };

  async function restoreOnce(
    sched: Schedule,
    spec: ScheduleSpecOnce,
  ): Promise<void> {
    if (sched.status?.lastRun) return;
    const at = onceFireAt(spec, sched.status, now());
    if (at) {
      await deps.repo.setNextRun(sched.id, at);
      await deps.queue.ensure(sched.id, at, now());
      return;
    }
    log(`restore: one-time schedule ${sched.id} never fired in its window`);
    await deps.repo.recordFire(sched.id, OnceResult.Missed, null);
    await emitChanged(sched.agentId, sched.id);
  }

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
    if (sched.spec.model) payload.model = sched.spec.model;
    if (sched.status?.lastRun) payload.lastRunAt = sched.status.lastRun;
    if (sched.spec.type === "once") {
      payload.once = true;
      if (sched.spec.origin)
        payload.origin = { ...sched.spec.origin, name: sched.name };
    }
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
    const event = { id: eventId, kind: "trigger" as const, payload, expiresAt };
    if (sched.spec.type !== "once") {
      await deps.runtimeMutator.bump(sched.agentId, [event]);
      return;
    }
    await deps.repo.transaction(async (tx) => {
      await deps.repo.recordFire(sched.id, OnceResult.Delivering, null, tx);
      await deps.runtimeMutator.bump(sched.agentId, [event], tx);
    });
  }

  async function pokeAgent(sched: Schedule, eventId: string): Promise<void> {
    await deps.runtimeMutator.enqueueAfterCommit(sched.agentId);
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

  async function fireOnce(
    sched: Schedule,
    spec: ScheduleSpecOnce,
    fireAt: Date,
    lastAttempt: boolean,
  ): Promise<void> {
    const action = onceFireAction(spec, sched.status, now());
    if (action.kind === "drop") {
      log(`fire: one-time schedule ${sched.id} already fired; dropping`);
      return;
    }
    if (action.kind === "missed") {
      log(`fire: one-time schedule ${sched.id} is past its window; missed`);
      await deps.repo.recordFire(sched.id, OnceResult.Missed, null);
      await emitChanged(sched.agentId, sched.id);
      return;
    }
    const eventId = `${sched.id}:${fireAt.getTime()}`;
    if (action.kind === "poke") {
      log(`fire: one-time schedule ${sched.id} is committed; poking again`);
    } else {
      try {
        await commitTrigger(
          sched,
          eventId,
          triggerPayload(sched, fireAt),
          action.expiresAt,
        );
      } catch (err) {
        const reason = (err as Error).message ?? String(err);
        log(`fire: one-time schedule ${sched.id} failed: ${reason}`);
        if (lastAttempt) {
          await deps.repo.recordFire(sched.id, reason, null).catch(() => {});
          await emitFired(sched, "failure");
        }
        throw err;
      }
    }
    try {
      await pokeAgent(sched, eventId);
    } catch (err) {
      log(
        `fire: one-time schedule ${sched.id} is committed but the poke failed: ${(err as Error).message}; it stays delivering`,
      );
      if (lastAttempt) await emitFired(sched, "failure");
      throw err;
    }
    await emitFired(sched, "success");
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
    const spec = sched.spec;
    if (spec.type === "once") return fireOnce(sched, spec, fireAt, lastAttempt);
    const hold = async (result: string) => {
      const after = nextFireAt(spec, now());
      await deps.repo.recordFire(scheduleId, result, after).catch(() => {});
      if (after) await deps.queue.enqueue(scheduleId, after, now());
    };
    if (await deps.onboardingPending?.(sched.agentId)) {
      log(`fire: agent ${sched.agentId} has not finished onboarding; holding`);
      await hold("held: onboarding not complete");
      return;
    }
    if (await deps.runtimeMigrating?.(sched.agentId)) {
      log(`fire: agent ${sched.agentId} is moving to the new runtime; holding`);
      await hold("held: moving to the new runtime");
      return;
    }

    const eventId = `${scheduleId}:${fireAt.getTime()}`;
    const firedAt = now();
    const expiresAt = triggerExpiry(
      firedAt,
      nextFireAt(spec, firedAt),
      TRIGGER_TTL_SECONDS,
    );

    try {
      await commitTrigger(
        sched,
        eventId,
        triggerPayload(sched, fireAt),
        expiresAt,
      );
      await pokeAgent(sched, eventId);
    } catch (err) {
      const result = (err as Error).message ?? String(err);
      log(`fire: schedule ${scheduleId} failed: ${result}`);
      const after = lastAttempt ? nextFireAt(spec, now()) : fireAt;
      await deps.repo.recordFire(scheduleId, result, after).catch(() => {});
      if (lastAttempt) {
        if (after) await deps.queue.enqueue(scheduleId, after, now());
        await emitFired(sched, "failure");
      }
      throw err;
    }

    const next = nextFireAt(spec, now());
    if (spec.precheck) await deps.repo.setNextRun(scheduleId, next);
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
      const next = upcoming(sched);
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
      const expiresAt = new Date(
        firedAt.getTime() + TRIGGER_TTL_SECONDS * 1000,
      );

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
        log(
          `run-now: schedule ${scheduleId} delivery after commit failed: ${result}`,
        );
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
      const expiresAt = new Date(now().getTime() + TRIGGER_TTL_SECONDS * 1000);
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
      if (input.stage === "run" && input.outcome === "failed")
        await deps.repo.stampFire(
          input.scheduleId,
          input.detail ?? "the run could not start",
        );
      else if (input.ranPrecheck === null) return;
      else if (sched.spec.precheck === input.ranPrecheck)
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

    async recordDelivery(scheduleId, transition): Promise<void> {
      const sched = await deps.repo.getById(scheduleId);
      if (sched?.spec.type !== "once") return;
      const outcome = match(transition)
        .with("settled", () => OnceResult.Success)
        .with("expired", () => OnceResult.Missed)
        .exhaustive();
      const changed = await deps.repo.replaceResult(
        scheduleId,
        OnceResult.Delivering,
        outcome,
      );
      if (changed) await emitChanged(sched.agentId, scheduleId);
      else
        log(
          `delivery: one-time schedule ${scheduleId} is at ${sched.status?.lastResult ?? "no result"}, not ${OnceResult.Delivering}; ${outcome} dropped`,
        );
    },

    async recordOnceFailure(scheduleId, reason): Promise<void> {
      const sched = await deps.repo.getById(scheduleId);
      if (sched?.spec.type !== "once") return;
      await deps.repo.recordFire(scheduleId, reason, null);
      await emitChanged(sched.agentId, scheduleId);
    },

    async restoreAll(): Promise<void> {
      const enabled = await deps.repo.listAllEnabled();
      for (const s of enabled) {
        if (s.spec.type === "once") {
          await restoreOnce(s, s.spec);
          continue;
        }
        const stored = s.status?.nextRun ? new Date(s.status.nextRun) : null;
        const next = stored ?? nextFireAt(s.spec, now());
        if (!stored) await deps.repo.setNextRun(s.id, next);
        if (next) await deps.queue.ensure(s.id, next, now());
      }
      log(`restored ${enabled.length} schedules`);
    },
  };
}
