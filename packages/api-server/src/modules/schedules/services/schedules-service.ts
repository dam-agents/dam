import type {
  SchedulesService,
  ScheduleCreateCronInput,
  ScheduleCreateRRuleInput,
  ScheduleUpdateRRuleInput,
} from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import {
  validateCron,
  validateHasVisibleOccurrence,
  validateRRule,
  validateTimezone,
} from "../domain/recurrences.js";

export function createSchedulesService(deps: {
  repo: SchedulesRepository;
  owner: string;
}): SchedulesService {
  return {
    list: (agentId) => deps.repo.list(agentId, deps.owner),
    get: (id) => deps.repo.get(id, deps.owner),

    async createCron(input: ScheduleCreateCronInput, createdBy = "user") {
      validateCron(input.cron);
      const exists = await deps.repo.agentExists(input.agentId, deps.owner);
      if (!exists) throw new Error(`Agent "${input.agentId}" not found`);

      const spec: Record<string, unknown> = {
        name: input.name,
        version: SPEC_VERSION,
        type: "cron" as const,
        cron: input.cron,
        task: input.task,
        enabled: true,
        createdBy,
      };
      if (input.sessionMode) spec.sessionMode = input.sessionMode;
      return deps.repo.create(input.agentId, spec, deps.owner);
    },

    async createRRule(input: ScheduleCreateRRuleInput) {
      validateTimezone(input.timezone);
      validateRRule(input.rrule);
      validateHasVisibleOccurrence(input.rrule, input.quietHours ?? []);
      const exists = await deps.repo.agentExists(input.agentId, deps.owner);
      if (!exists) throw new Error(`Agent "${input.agentId}" not found`);

      const spec: Record<string, unknown> = {
        name: input.name,
        version: SPEC_VERSION,
        type: "rrule" as const,
        rrule: input.rrule,
        timezone: input.timezone,
        task: input.task,
        enabled: true,
        createdBy: "user",
      };
      if (input.quietHours && input.quietHours.length > 0) {
        spec.quietHours = input.quietHours;
      }
      if (input.sessionMode) spec.sessionMode = input.sessionMode;
      return deps.repo.create(input.agentId, spec, deps.owner);
    },

    async updateRRule(input: ScheduleUpdateRRuleInput) {
      validateTimezone(input.timezone);
      validateRRule(input.rrule);
      validateHasVisibleOccurrence(input.rrule, input.quietHours);
      const patch: Record<string, unknown> = {
        name: input.name,
        type: "rrule" as const,
        rrule: input.rrule,
        timezone: input.timezone,
        quietHours: input.quietHours,
        task: input.task,
      };
      if (input.sessionMode) patch.sessionMode = input.sessionMode;
      return deps.repo.update(input.id, patch, deps.owner);
    },

    delete: (id) => deps.repo.delete(id, deps.owner),
    toggle: (id) => deps.repo.toggle(id, deps.owner),
  };
}
