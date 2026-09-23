import { TRPCError } from "@trpc/server";
import type {
  SchedulesService,
  ScheduleCreateCronInput,
  ScheduleCreateOnceInput,
  ScheduleCreateRRuleInput,
  ScheduleSpec,
  ScheduleUpdateOnceInput,
  ScheduleUpdateRRuleInput,
} from "api-server-api";
import { OnceResult, SPEC_VERSION } from "api-server-api";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { SchedulerRunner } from "./scheduler-runner.js";
import {
  validateCron,
  validateHasVisibleOccurrence,
  validateRRule,
  validateTimezone,
} from "../domain/recurrences.js";
import { resolveOnceMoment } from "../domain/once.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";

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

export function createSchedulesService(deps: {
  repo: SchedulesRepository;
  runner: SchedulerRunner;
  owner: string;
  agentBinding: readonly string[] | "*";
  agentExists?: (agentId: string) => Promise<boolean>;
  agentOnceLimits?: AgentOnceLimits;
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
    list: (agentId) => deps.repo.list(agentId, deps.owner),
    listForOwner: (limit) =>
      deps.repo.listForOwner(deps.owner, {
        ...(limit === undefined ? {} : { limit }),
        ...(binding === "*" ? {} : { agentIds: binding }),
      }),
    get: (id) => deps.repo.get(id, deps.owner),

    async createCron(input: ScheduleCreateCronInput, createdBy = "user") {
      asBadRequest(() => validateCron(input.cron));
      await ensureAgent(input.agentId);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "cron",
        cron: input.cron,
        task: input.task,
        enabled: true,
        createdBy,
        ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
        ...(input.precheck ? { precheck: input.precheck } : {}),
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
          cron: input.cron,
          ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
        },
      });
      return schedule;
    },

    async createRRule(input: ScheduleCreateRRuleInput, createdBy = "user") {
      asBadRequest(() => validateTimezone(input.timezone));
      asBadRequest(() => validateRRule(input.rrule));
      asBadRequest(() =>
        validateHasVisibleOccurrence(input.rrule, input.quietHours ?? []),
      );
      await ensureAgent(input.agentId);
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
          ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
        },
      });
      return schedule;
    },

    async createOnce(input: ScheduleCreateOnceInput, createdBy = "user") {
      asBadRequest(() => validateTimezone(input.timezone));
      const at = resolveMoment(input.at, input.timezone, now());
      await ensureAgent(input.agentId);
      if (createdBy === "agent") await ensureAgentWithinLimits(input.agentId);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "once",
        at: at.toISOString(),
        timezone: input.timezone,
        task: input.task,
        enabled: true,
        createdBy,
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
        detail: { createdBy, type: "once", at: spec.at },
      });
      return (await deps.repo.get(schedule.id, deps.owner)) ?? schedule;
    },

    async updateOnce(input: ScheduleUpdateOnceInput) {
      asBadRequest(() => validateTimezone(input.timezone));
      const current = await deps.repo.get(input.id, deps.owner);
      if (!current) return null;
      if (current.spec.type !== "once")
        throw badRequest("not a one-time schedule");
      if (current.status?.lastRun)
        throw badRequest("a one-time schedule cannot be edited once it fired");
      const at = resolveMoment(input.at, input.timezone, now());
      const spec: ScheduleSpec = {
        ...current.spec,
        at: at.toISOString(),
        timezone: input.timezone,
        task: input.task,
      };
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

    async updateRRule(input: ScheduleUpdateRRuleInput) {
      asBadRequest(() => validateTimezone(input.timezone));
      asBadRequest(() => validateRRule(input.rrule));
      asBadRequest(() =>
        validateHasVisibleOccurrence(input.rrule, input.quietHours),
      );
      const current = await deps.repo.get(input.id, deps.owner);
      if (!current) return null;
      if (current.spec.type === "once")
        throw badRequest("a one-time schedule is edited with updateOnce");
      const spec: ScheduleSpec = {
        ...current.spec,
        type: "rrule",
        rrule: input.rrule,
        timezone: input.timezone,
        quietHours: input.quietHours,
        task: input.task,
      };
      if (input.sessionMode) spec.sessionMode = input.sessionMode;
      else delete spec.sessionMode;
      if (input.precheck) spec.precheck = input.precheck;
      else if (input.precheck !== undefined) delete spec.precheck;
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

    async toggle(id) {
      const current = await deps.repo.get(id, deps.owner);
      if (current?.spec.type === "once")
        throw badRequest("a one-time schedule cannot be paused; delete it");
      const next = await deps.repo.toggle(id, deps.owner);
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

    async resetSession(id) {
      const sched = await deps.repo.get(id, deps.owner);
      if (!sched) return;
      await deps.runner.resetSession(id);
    },
  };
}
