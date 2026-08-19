import { TRPCError } from "@trpc/server";
import type {
  SchedulesService,
  ScheduleCreateCronInput,
  ScheduleCreateRRuleInput,
  ScheduleSpec,
  ScheduleUpdateRRuleInput,
} from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { SchedulerRunner } from "./scheduler-runner.js";
import {
  validateCron,
  validateHasVisibleOccurrence,
  validateRRule,
  validateTimezone,
} from "../domain/recurrences.js";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";

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
  agentExists?: (agentId: string) => Promise<boolean>;
}): SchedulesService {
  async function ensureAgent(agentId: string): Promise<void> {
    if (!deps.agentExists) return;
    const ok = await deps.agentExists(agentId);
    if (!ok) throw new Error(`Agent "${agentId}" not found`);
  }

  return {
    list: (agentId) => deps.repo.list(agentId, deps.owner),
    listForOwner: (limit) => deps.repo.listForOwner(deps.owner, limit),
    get: (id) => deps.repo.get(id, deps.owner),

    async createCron(input: ScheduleCreateCronInput, createdBy = "user") {
      validateCron(input.cron);
      await ensureAgent(input.agentId);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "cron",
        cron: input.cron,
        task: input.task,
        enabled: true,
        createdBy,
        ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
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
          ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
        },
      });
      return schedule;
    },

    async updateRRule(input: ScheduleUpdateRRuleInput) {
      asBadRequest(() => validateTimezone(input.timezone));
      asBadRequest(() => validateRRule(input.rrule));
      asBadRequest(() =>
        validateHasVisibleOccurrence(input.rrule, input.quietHours),
      );
      const current = await deps.repo.get(input.id, deps.owner);
      if (!current) return null;
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
      await deps.repo.updateName(input.id, deps.owner, input.name);
      const updated = await deps.repo.updateSpec(input.id, deps.owner, spec);
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
