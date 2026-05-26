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
      return schedule;
    },

    async createRRule(input: ScheduleCreateRRuleInput) {
      validateTimezone(input.timezone);
      validateRRule(input.rrule);
      validateHasVisibleOccurrence(input.rrule, input.quietHours ?? []);
      await ensureAgent(input.agentId);
      const spec: ScheduleSpec = {
        version: SPEC_VERSION,
        type: "rrule",
        rrule: input.rrule,
        timezone: input.timezone,
        task: input.task,
        enabled: true,
        createdBy: "user",
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
      return schedule;
    },

    async updateRRule(input: ScheduleUpdateRRuleInput) {
      validateTimezone(input.timezone);
      validateRRule(input.rrule);
      validateHasVisibleOccurrence(input.rrule, input.quietHours);
      const current = await deps.repo.get(input.id, deps.owner);
      if (!current) return null;
      const spec: ScheduleSpec = {
        ...current.spec,
        type: "rrule",
        rrule: input.rrule,
        timezone: input.timezone,
        quietHours: input.quietHours,
        task: input.task,
        ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
      };
      await deps.repo.updateName(input.id, deps.owner, input.name);
      const updated = await deps.repo.updateSpec(input.id, deps.owner, spec);
      if (updated) await deps.runner.sync(updated.id);
      return updated;
    },

    async delete(id) {
      await deps.runner.cancel(id);
      await deps.repo.delete(id, deps.owner);
    },

    async toggle(id) {
      const next = await deps.repo.toggle(id, deps.owner);
      if (!next) return null;
      if (next.spec.enabled) {
        await deps.runner.sync(id);
      } else {
        await deps.runner.cancel(id);
      }
      return next;
    },
  };
}
