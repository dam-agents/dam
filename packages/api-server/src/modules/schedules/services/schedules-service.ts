import { TRPCError } from "@trpc/server";
import type {
  Schedule,
  SchedulesService,
  ScheduleCreateCronInput,
  ScheduleCreateOnceInput,
  ScheduleOnceOrigin,
  ScheduleCreateRRuleInput,
  ScheduleSpec,
  ScheduleUpdateOnceInput,
  ScheduleUpdateCronInput,
  ScheduleUpdateRRuleInput,
} from "api-server-api";
import { OnceResult, SPEC_VERSION } from "api-server-api";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { RunNowResult, SchedulerRunner } from "./scheduler-runner.js";
import {
  nextFire,
  validateCron,
  validateRRule,
  validateTimezone,
} from "../domain/recurrences.js";
import { resolveOnceMoment } from "../domain/once.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";

const RUN_NOW_REFUSAL: Record<Exclude<RunNowResult, "started">, string> = {
  "onboarding-pending": "the agent has not finished onboarding yet",
  "spend-limit":
    "the agent reached its spend limit for today. Continue the limit, or wait until midnight UTC",
  "spend-ceiling":
    "the agent's owner reached the spend ceiling for today. The platform operator can raise it; otherwise wait until midnight UTC",
  "no-default-model":
    "the agent has no default model. Set one on its Providers page, or pick a model for this schedule",
  "default-pending":
    "the agent is moving to a new image and setting up its default model. Try again in a minute",
};

export interface AgentOnceLimits {
  maxOpen: number;
  maxPerHour: number;
}

const HOUR_MS = 60 * 60 * 1000;

function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

function resolveMoment(
  at: string | undefined,
  timezone: string,
  now: Date,
): Date {
  try {
    return resolveOnceMoment(at, timezone, now);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : "invalid time");
  }
}

function withStopReason(schedule: Schedule): Schedule {
  if (
    schedule.spec.type === "once" ||
    !schedule.spec.enabled ||
    schedule.status?.nextRun
  )
    return schedule;
  const next = nextFire(schedule.spec, new Date());
  if (next.kind !== "stopped") return schedule;
  return {
    ...schedule,
    status: { ...schedule.status, stopReason: next.reason },
  };
}

function asBadRequest(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: e instanceof Error ? e.message : "invalid schedule",
    });
  }
}

function choicesOf(input: {
  harness?: string | null;
  model?: string | null;
  settings?: Record<string, string> | null;
  profile?: string | null;
}): {
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
  profile?: string;
} {
  if (input.profile) return { profile: input.profile };
  return {
    ...(input.harness ? { harness: input.harness } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.settings ? { settings: input.settings } : {}),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a partial update names only the choices it
 * changes (undefined keeps, null clears), so the choices validated are the
 * ones the stored schedule ends up with, never the changed fields alone.
 */
/* UNIT_BOUNDARY_DESCRIPTION: a schedule stores a profile or its own values,
 * never both. Naming a profile clears the inline fields; a form that merely
 * repeats the values the profile resolves to — or blanks one — keeps the
 * reference, because a task-only edit from a form must not detach it; only a
 * value that differs detaches, and it detaches to the values the schedule was
 * running on plus the change. */
function applyProfileTransition(
  spec: {
    profile?: string;
    harness?: string;
    model?: string;
    settings?: Record<string, string>;
  },
  input: {
    profile?: string | null;
    harness?: string | null;
    model?: string | null;
    settings?: Record<string, string> | null;
  },
  resolved?: {
    harness?: string;
    model?: string;
    settings?: Record<string, string>;
  },
): void {
  if (input.profile === null) {
    delete spec.profile;
    return;
  }
  if (input.profile !== undefined) {
    spec.profile = input.profile;
    delete spec.harness;
    delete spec.model;
    delete spec.settings;
    return;
  }
  if (spec.profile === undefined) return;
  const given = {
    harness: input.harness,
    model: input.model,
    settings: input.settings,
  };
  const differs = (key: "harness" | "model" | "settings"): boolean => {
    const value = given[key];
    if (value === undefined || value === null) return false;
    if (key === "settings")
      return !sameSettings(
        value as Record<string, string>,
        resolved?.settings ?? {},
      );
    return value !== resolved?.[key];
  };
  if (!differs("harness") && !differs("model") && !differs("settings")) {
    delete spec.harness;
    delete spec.model;
    delete spec.settings;
    return;
  }
  /* UNIT_BOUNDARY_DESCRIPTION: only a key the caller said nothing about is
   * carried over from the profile. A key the caller cleared stays cleared, and
   * the final choices are validated by the caller exactly as a picked one is,
   * so a detach never refills what someone removed. */
  delete spec.profile;
  for (const key of ["harness", "model", "settings"] as const)
    if (input[key] === undefined && resolved?.[key] !== undefined)
      Object.assign(spec, { [key]: resolved[key] });
}

/* UNIT_BOUNDARY_DESCRIPTION: two settings records are the same when their content
 * is, whatever order the keys arrived in, so editing a value and changing it back
 * never reads as a change. */
function sameSettings(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const entries = (value: Readonly<Record<string, string>>) =>
    JSON.stringify(
      Object.entries(value).sort(([x], [y]) => x.localeCompare(y)),
    );
  return entries(a) === entries(b);
}

/* UNIT_BOUNDARY_DESCRIPTION: a write starts from the stored spec, never from the
 * resolved one, or a profile schedule would be saved with a frozen copy of the
 * values beside the reference. The resolved read is still what validates and
 * what a detach copies. */
function storedCurrentSpec(
  stored: Schedule | null,
  current: Schedule,
): Extract<ScheduleSpec, { type: "once" }> {
  return stored?.spec.type === "once"
    ? stored.spec
    : (current.spec as Extract<ScheduleSpec, { type: "once" }>);
}

function requireStored(stored: Schedule | null, current: Schedule): Schedule {
  return stored ?? current;
}

function mergedChoices(
  input: {
    harness?: string | null;
    model?: string | null;
    settings?: Record<string, string> | null;
  },
  spec: {
    harness?: string;
    model?: string;
    settings?: Record<string, string>;
  },
): { harness?: string; model?: string; settings?: Record<string, string> } {
  const pick = <T>(next: T | null | undefined, stored: T | undefined) =>
    next === undefined ? stored : (next ?? undefined);
  return {
    harness: pick(input.harness, spec.harness),
    model: pick(input.model, spec.model),
    settings: pick(input.settings, spec.settings),
  };
}

function choicesChanged(
  input: {
    harness?: string | null;
    model?: string | null;
    settings?: Record<string, string> | null;
  },
  spec: {
    harness?: string;
    model?: string;
    settings?: Record<string, string>;
  },
): boolean {
  return JSON.stringify(choicesOf(input)) !== JSON.stringify(choicesOf(spec));
}

export function createSchedulesService(deps: {
  repo: SchedulesRepository;
  runner: SchedulerRunner;
  owner: string;
  agentBinding: readonly string[] | "*";
  agentExists?: (agentId: string) => Promise<boolean>;
  agentOnceLimits?: AgentOnceLimits;
  validateSessionChoices?: (
    agentId: string,
    choices: {
      harness?: string;
      model?: string;
      settings?: Record<string, string>;
    },
  ) => Promise<string | undefined>;
  ownedProfile?: (profileId: string) => Promise<boolean>;
  /** UNIT_BOUNDARY_DESCRIPTION: why a profile cannot run on this agent, or null; absent leaves the check to the fire. */
  profileIssue?: (profileId: string, agentId: string) => Promise<string | null>;
  now?: () => Date;
}): SchedulesService {
  const now = deps.now ?? (() => new Date());
  const binding = deps.agentBinding;
  async function ensureAgent(agentId: string): Promise<void> {
    if (!deps.agentExists) return;
    const ok = await deps.agentExists(agentId);
    if (!ok)
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: checked at save with the one validator the
   * fire re-runs, so a schedule is refused naming the reason rather than
   * saved to fail later. A task that continues its session keeps that
   * session's choices.
   */
  /* UNIT_BOUNDARY_DESCRIPTION: a schedule may only name a profile its owner
   * holds. Whether that profile can run on the agent right now is the fire's
   * question, reported as a failing run, exactly as a custom pair on a provider
   * the agent lost behaves. */
  async function ensureProfileOwned(profile: string | null | undefined) {
    if (!profile) return;
    if (deps.ownedProfile === undefined || !(await deps.ownedProfile(profile)))
      throw badRequest("unknown profile");
  }

  /* UNIT_BOUNDARY_DESCRIPTION: a schedule whose profile cannot run on its agent
   * would refuse every fire, so the save is refused with that reason instead —
   * the same refusal a channel's profile gets (QA D4). */
  async function ensureProfileRuns(
    profile: string | null | undefined,
    agentId: string,
  ) {
    await ensureProfileOwned(profile);
    if (!profile || deps.profileIssue === undefined) return;
    const issue = await deps.profileIssue(profile, agentId);
    if (issue !== null) throw badRequest(`that profile cannot run: ${issue}`);
  }

  async function ensureSessionChoices(
    agentId: string,
    choices: {
      harness?: string;
      model?: string;
      settings?: Record<string, string>;
    },
    origin: ScheduleOnceOrigin | undefined,
  ): Promise<void> {
    const named = Object.values(choices).some((v) => v !== undefined);
    if (!named) return;
    if (origin?.mode === "continue")
      throw badRequest(
        "a task that continues its session keeps that session's harness, model and settings; drop them or run it fresh",
      );
    const refusal = await deps.validateSessionChoices?.(agentId, choices);
    if (refusal) throw badRequest(refusal);
  }

  async function ensureAgentWithinLimits(agentId: string): Promise<void> {
    const limits = deps.agentOnceLimits;
    if (!limits) return;
    const { open, recent } = await deps.repo.countAgentOnce(
      agentId,
      OnceResult.Delivering,
      new Date(now().getTime() - HOUR_MS),
    );
    if (open >= limits.maxOpen)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `this agent already has ${open} one-time schedules waiting to run (limit ${limits.maxOpen}); delete one or let them fire first — a user can still create one-time tasks in the UI`,
      });
    if (recent >= limits.maxPerHour)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `this agent created ${recent} one-time schedules in the last hour (limit ${limits.maxPerHour}); try again later — a user can still create one-time tasks in the UI`,
      });
  }

  return {
    list: async (agentId) =>
      (await deps.repo.list(agentId, deps.owner)).map(withStopReason),
    listForOwner: async (limit) =>
      (
        await deps.repo.listForOwner(deps.owner, {
          ...(limit === undefined ? {} : { limit }),
          ...(binding === "*" ? {} : { agentIds: binding }),
        })
      ).map(withStopReason),
    get: async (id) => {
      const schedule = await deps.repo.get(id, deps.owner);
      return schedule && withStopReason(schedule);
    },

    async createCron(input: ScheduleCreateCronInput, createdBy = "user") {
      asBadRequest(() => validateCron(input.cron));
      await ensureAgent(input.agentId);
      await ensureProfileRuns(input.profile, input.agentId);
      if (!input.profile)
        await ensureSessionChoices(input.agentId, choicesOf(input), undefined);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "cron",
        cron: input.cron,
        task: input.task,
        enabled: true,
        createdBy,
        ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
        ...(input.precheck ? { precheck: input.precheck } : {}),
        ...choicesOf(input),
        ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
      };
      const schedule = await deps.repo.create({
        agentId: input.agentId,
        owner: deps.owner,
        name: input.name,
        spec,
      });
      await deps.runner.sync(schedule.id);
      emit({
        type: EventType.ScheduleCreated,
        scheduleId: schedule.id,
        agentId: input.agentId,
        ownerSub: deps.owner,
      });
      securityLog("info", "schedule.create", {
        category: "privileged",
        actor: deps.owner,
        actorKind: createdBy === "agent" ? "agent" : "user",
        agentId: input.agentId,
        target: schedule.id,
        result: "success",
        detail: {
          createdBy,
          type: "cron",
          precheck: Boolean(input.precheck),
          ...(input.model ? { model: input.model } : {}),
          cron: input.cron,
          ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
        },
      });
      return schedule;
    },

    async createRRule(input: ScheduleCreateRRuleInput, createdBy = "user") {
      asBadRequest(() => validateTimezone(input.timezone));
      asBadRequest(() =>
        validateRRule(input.rrule, input.timezone, input.quietHours ?? []),
      );
      await ensureAgent(input.agentId);
      await ensureProfileRuns(input.profile, input.agentId);
      if (!input.profile)
        await ensureSessionChoices(input.agentId, choicesOf(input), undefined);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "rrule",
        rrule: input.rrule,
        timezone: input.timezone,
        task: input.task,
        enabled: true,
        createdBy,
        ...(input.quietHours && input.quietHours.length > 0
          ? { quietHours: input.quietHours }
          : {}),
        ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
        ...(input.precheck ? { precheck: input.precheck } : {}),
        ...choicesOf(input),
        ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
      };
      const schedule = await deps.repo.create({
        agentId: input.agentId,
        owner: deps.owner,
        name: input.name,
        spec,
      });
      await deps.runner.sync(schedule.id);
      emit({
        type: EventType.ScheduleCreated,
        scheduleId: schedule.id,
        agentId: input.agentId,
        ownerSub: deps.owner,
      });
      securityLog("info", "schedule.create", {
        category: "privileged",
        actor: deps.owner,
        actorKind: createdBy === "agent" ? "agent" : "user",
        agentId: input.agentId,
        target: schedule.id,
        result: "success",
        detail: {
          createdBy,
          type: "rrule",
          precheck: Boolean(input.precheck),
          ...(input.model ? { model: input.model } : {}),
          ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
        },
      });
      return schedule;
    },

    async createOnce(
      input: ScheduleCreateOnceInput,
      createdBy = "user",
      origin?: ScheduleOnceOrigin,
    ) {
      asBadRequest(() => validateTimezone(input.timezone));
      const at = resolveMoment(input.at, input.timezone, now());
      await ensureAgent(input.agentId);
      await ensureProfileRuns(input.profile, input.agentId);
      if (!input.profile)
        await ensureSessionChoices(input.agentId, choicesOf(input), origin);
      if (input.sessionTitle && origin?.mode === "continue")
        throw badRequest(
          "a task that continues its session keeps that session's title; drop the session title or run it fresh",
        );
      if (createdBy === "agent") await ensureAgentWithinLimits(input.agentId);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "once",
        at: at.toISOString(),
        timezone: input.timezone,
        task: input.task,
        enabled: true,
        createdBy,
        ...(origin ? { origin } : {}),
        ...choicesOf(input),
        ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
      };
      const schedule = await deps.repo.create({
        agentId: input.agentId,
        owner: deps.owner,
        name: input.name,
        spec,
      });
      await deps.runner.sync(schedule.id);
      emit({
        type: EventType.ScheduleCreated,
        scheduleId: schedule.id,
        agentId: input.agentId,
        ownerSub: deps.owner,
      });
      securityLog("info", "schedule.create", {
        category: "privileged",
        actor: deps.owner,
        actorKind: createdBy === "agent" ? "agent" : "user",
        agentId: input.agentId,
        target: schedule.id,
        result: "success",
        detail: {
          createdBy,
          type: "once",
          at: spec.at,
          inSession: origin?.mode ?? "fresh",
        },
      });
      return (await deps.repo.get(schedule.id, deps.owner)) ?? schedule;
    },

    async updateOnce(input: ScheduleUpdateOnceInput) {
      asBadRequest(() => validateTimezone(input.timezone));
      const current = await deps.repo.get(input.id, deps.owner);
      const stored = await deps.repo.getRaw(input.id, deps.owner);
      if (!current) return null;
      if (current.spec.type !== "once")
        throw badRequest("not a one-time schedule");
      if (current.status?.lastRun)
        throw badRequest("a one-time schedule cannot be edited once it fired");
      await ensureProfileRuns(input.profile, current.agentId);
      const at = resolveMoment(input.at, input.timezone, now());
      if (input.profile === undefined && choicesChanged(input, current.spec))
        await ensureSessionChoices(
          current.agentId,
          choicesOf(input),
          current.spec.origin,
        );
      if (input.sessionTitle && current.spec.origin?.mode === "continue")
        throw badRequest(
          "a task that continues its session keeps that session's title; drop the session title",
        );
      const {
        harness: _previousHarness,
        model: _previous,
        settings: _previousSettings,
        migrationNote: _previousNote,
        sessionTitle: _previousTitle,
        ...unchanged
      } = storedCurrentSpec(stored, current);
      const spec: ScheduleSpec = {
        ...unchanged,
        at: at.toISOString(),
        timezone: input.timezone,
        task: input.task,
        ...choicesOf(input),
        ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
      };
      applyProfileTransition(spec, input, current.spec);
      if (current.spec.profile !== undefined && spec.profile === undefined)
        await ensureSessionChoices(
          current.agentId,
          {
            ...(spec.harness && { harness: spec.harness }),
            ...(spec.model && { model: spec.model }),
            ...(spec.settings && { settings: spec.settings }),
          },
          undefined,
        );
      await deps.repo.updateName(input.id, deps.owner, input.name);
      const updated = await deps.repo.updateSpec(input.id, deps.owner, spec);
      if (!updated) return null;
      await deps.runner.sync(updated.id);
      emit({
        type: EventType.ScheduleUpdated,
        scheduleId: updated.id,
        agentId: updated.agentId,
        ownerSub: deps.owner,
      });
      return deps.repo.get(updated.id, deps.owner);
    },

    async updateCron(input: ScheduleUpdateCronInput) {
      asBadRequest(() => validateCron(input.cron));
      const current = await deps.repo.get(input.id, deps.owner);
      const stored = await deps.repo.getRaw(input.id, deps.owner);
      if (!current) return null;
      if (current.spec.type !== "cron")
        throw badRequest("only a cron schedule is edited with updateCron");
      await ensureProfileRuns(input.profile, current.agentId);
      const merged = mergedChoices(input, current.spec);
      if (input.profile === undefined && choicesChanged(merged, current.spec))
        await ensureSessionChoices(
          current.agentId,
          choicesOf(merged),
          undefined,
        );
      const spec: ScheduleSpec = {
        ...(stored?.spec.type === "cron" ? stored.spec : current.spec),
        cron: input.cron,
        task: input.task,
      };
      if (input.sessionMode) spec.sessionMode = input.sessionMode;
      else delete spec.sessionMode;
      if (input.precheck) spec.precheck = input.precheck;
      else if (input.precheck !== undefined) delete spec.precheck;
      if (input.model) spec.model = input.model;
      else if (input.model !== undefined) delete spec.model;
      if (input.harness) spec.harness = input.harness;
      else if (input.harness !== undefined) delete spec.harness;
      if (input.settings) spec.settings = input.settings;
      else if (input.settings !== undefined) delete spec.settings;
      if (input.model !== undefined || input.harness !== undefined)
        delete spec.migrationNote;
      applyProfileTransition(spec, input, current.spec);
      /* UNIT_BOUNDARY_DESCRIPTION: a detach leaves choices the caller kept, and
       * they are validated here as the stored ones, never only as sent. */
      if (current.spec.profile !== undefined && spec.profile === undefined)
        await ensureSessionChoices(
          current.agentId,
          {
            ...(spec.harness && { harness: spec.harness }),
            ...(spec.model && { model: spec.model }),
            ...(spec.settings && { settings: spec.settings }),
          },
          undefined,
        );
      if (input.sessionTitle) spec.sessionTitle = input.sessionTitle;
      else if (input.sessionTitle !== undefined) delete spec.sessionTitle;
      await deps.repo.updateName(input.id, deps.owner, input.name);
      const updated = await deps.repo.updateSpec(input.id, deps.owner, spec);
      if (updated && spec.precheck !== current.spec.precheck)
        await deps.repo.clearPrecheckStatus(input.id);
      if (updated) {
        await deps.runner.sync(updated.id);
        emit({
          type: EventType.ScheduleUpdated,
          scheduleId: updated.id,
          agentId: updated.agentId,
          ownerSub: deps.owner,
        });
      }
      return updated;
    },

    async updateRRule(input: ScheduleUpdateRRuleInput) {
      asBadRequest(() => validateTimezone(input.timezone));
      asBadRequest(() =>
        validateRRule(input.rrule, input.timezone, input.quietHours ?? []),
      );
      const current = await deps.repo.get(input.id, deps.owner);
      const stored = await deps.repo.getRaw(input.id, deps.owner);
      if (!current) return null;
      if (current.spec.type === "once")
        throw badRequest("a one-time schedule is edited with updateOnce");
      await ensureProfileRuns(input.profile, current.agentId);
      const merged = mergedChoices(input, current.spec);
      if (input.profile === undefined && choicesChanged(merged, current.spec))
        await ensureSessionChoices(
          current.agentId,
          choicesOf(merged),
          undefined,
        );
      const base = stored?.spec ?? current.spec;
      const { cron: _cron, ...unchanged } =
        base.type === "cron" ? base : { ...base, cron: undefined };
      const spec: ScheduleSpec = {
        ...unchanged,
        type: "rrule",
        rrule: input.rrule,
        timezone: input.timezone,
        task: input.task,
      };
      /* UNIT_BOUNDARY_DESCRIPTION: quiet hours follow the rule every other
       * choice does — omitted keeps them, null or an empty list clears them, a
       * list sets them — so a no-change save writes nothing and a form that
       * removed them leaves none stored. */
      if (input.quietHours === null || input.quietHours?.length === 0)
        delete spec.quietHours;
      else if (input.quietHours !== undefined)
        spec.quietHours = input.quietHours;
      if (input.sessionMode) spec.sessionMode = input.sessionMode;
      else delete spec.sessionMode;
      if (input.precheck) spec.precheck = input.precheck;
      else if (input.precheck !== undefined) delete spec.precheck;
      if (input.model) spec.model = input.model;
      else if (input.model !== undefined) delete spec.model;
      if (input.harness) spec.harness = input.harness;
      else if (input.harness !== undefined) delete spec.harness;
      if (input.settings) spec.settings = input.settings;
      else if (input.settings !== undefined) delete spec.settings;
      if (input.model !== undefined || input.harness !== undefined)
        delete spec.migrationNote;
      applyProfileTransition(spec, input, current.spec);
      /* UNIT_BOUNDARY_DESCRIPTION: a detach leaves choices the caller kept, and
       * they are validated here as the stored ones, never only as sent. */
      if (current.spec.profile !== undefined && spec.profile === undefined)
        await ensureSessionChoices(
          current.agentId,
          {
            ...(spec.harness && { harness: spec.harness }),
            ...(spec.model && { model: spec.model }),
            ...(spec.settings && { settings: spec.settings }),
          },
          undefined,
        );
      if (input.sessionTitle) spec.sessionTitle = input.sessionTitle;
      else if (input.sessionTitle !== undefined) delete spec.sessionTitle;
      await deps.repo.updateName(input.id, deps.owner, input.name);
      const updated = await deps.repo.updateSpec(input.id, deps.owner, spec);
      if (updated && spec.precheck !== current.spec.precheck)
        await deps.repo.clearPrecheckStatus(input.id);
      if (updated) {
        await deps.runner.sync(updated.id);
        emit({
          type: EventType.ScheduleUpdated,
          scheduleId: updated.id,
          agentId: updated.agentId,
          ownerSub: deps.owner,
        });
      }
      return updated;
    },

    async delete(id) {
      const current = await deps.repo.get(id, deps.owner);
      await deps.runner.cancel(id);
      await deps.repo.delete(id, deps.owner);
      if (current) {
        emit({
          type: EventType.ScheduleDeleted,
          scheduleId: id,
          agentId: current.agentId,
          ownerSub: deps.owner,
        });
      }
      securityLog("info", "schedule.delete", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        target: id,
        result: "success",
      });
    },

    async toggle(id, enabled) {
      const current = await deps.repo.get(id, deps.owner);
      const stored = await deps.repo.getRaw(id, deps.owner);
      if (!current) return null;
      if (current.spec.type === "once")
        throw badRequest("a one-time schedule cannot be paused; delete it");
      const next = await deps.repo.updateSpec(id, deps.owner, {
        ...requireStored(stored, current).spec,
        enabled: enabled ?? !current.spec.enabled,
      });
      if (!next) return null;
      if (next.spec.enabled) {
        await deps.runner.sync(id);
      } else {
        await deps.runner.cancel(id);
      }
      emit({
        type: EventType.ScheduleUpdated,
        scheduleId: id,
        agentId: next.agentId,
        ownerSub: deps.owner,
      });
      securityLog("info", "schedule.toggle", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId: next.agentId,
        target: id,
        result: "success",
        detail: { enabled: next.spec.enabled },
      });
      return next;
    },

    async clearSessionChoices(id) {
      const current = await deps.repo.get(id, deps.owner);
      if (!current) return null;
      if (
        current.spec.type === "once" &&
        current.spec.origin?.mode === "continue"
      )
        throw badRequest(
          "a task that continues its session keeps that session's choices",
        );
      const {
        harness: _harness,
        model: _model,
        settings: _settings,
        profile: _profile,
        migrationNote: _note,
        ...spec
      } = requireStored(await deps.repo.getRaw(id, deps.owner), current).spec;
      const next = await deps.repo.updateSpec(id, deps.owner, spec);
      if (!next) return null;
      emit({
        type: EventType.ScheduleUpdated,
        scheduleId: id,
        agentId: next.agentId,
        ownerSub: deps.owner,
      });
      securityLog("info", "schedule.clear_session_choices", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId: next.agentId,
        target: id,
        result: "success",
      });
      return next;
    },

    async resetSession(id) {
      const sched = await deps.repo.get(id, deps.owner);
      if (!sched) return;
      await deps.runner.resetSession(id);
    },

    async runNow(id) {
      const sched = await deps.repo.get(id, deps.owner);
      if (!sched)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "schedule not found",
        });
      if (sched.spec.type === "once")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "a one-time task runs only at its own moment",
        });
      const outcome = await deps.runner.runNow(id);
      if (outcome !== "started")
        throw new TRPCError({
          code: "CONFLICT",
          message: RUN_NOW_REFUSAL[outcome],
        });
      securityLog("info", "schedule.run-now", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId: sched.agentId,
        target: id,
        result: "success",
        detail: {
          precheck: Boolean(sched.spec.precheck),
          enabled: sched.spec.enabled,
        },
      });
    },
  };
}
