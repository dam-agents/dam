import type {
  SchedulesService,
  CreateCronScheduleInput,
  CreateRRuleScheduleInput,
  UpdateRRuleScheduleInput,
} from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import type { SchedulesRepository } from "./../infrastructure/schedules-repository.js";
import { validateCron, validateHasVisibleOccurrence, validateRRule, validateTimezone } from "../domain/recurrences.js";

export function createSchedulesService(deps: {
  repo: SchedulesRepository;
  owner: string;
}): SchedulesService {
  return {
    list: (instanceId) => deps.repo.list(instanceId, deps.owner),
    get: (id) => deps.repo.get(id, deps.owner),

    async createCron(input: CreateCronScheduleInput) {
      validateCron(input.cron);
      const agentRef = await deps.repo.readAgentRef(input.instanceId, deps.owner);
      if (!agentRef) throw new Error(`Instance "${input.instanceId}" not found`);

      const spec: Record<string, unknown> = {
        name: input.name,
        version: SPEC_VERSION,
        type: "cron" as const,
        cron: input.cron,
        task: input.task,
        enabled: true,
        createdBy: input.createdBy ?? "user",
      };
      if (input.sessionMode) spec.sessionMode = input.sessionMode;
      return deps.repo.create(input.instanceId, agentRef, spec, deps.owner);
    },

    async createRRule(input: CreateRRuleScheduleInput) {
      validateTimezone(input.timezone);
      validateRRule(input.rrule);
      validateHasVisibleOccurrence(input.rrule, input.quietHours ?? []);
      const agentRef = await deps.repo.readAgentRef(input.instanceId, deps.owner);
      if (!agentRef) throw new Error(`Instance "${input.instanceId}" not found`);

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
      return deps.repo.create(input.instanceId, agentRef, spec, deps.owner);
    },

    async updateRRule(input: UpdateRRuleScheduleInput) {
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
      // sessionMode is optional; only patch it when supplied so omitting it
      // means "keep current mode" rather than "clear to default."
      if (input.sessionMode) patch.sessionMode = input.sessionMode;
      return deps.repo.update(input.id, patch, deps.owner);
    },

    delete: (id) => deps.repo.delete(id, deps.owner),
    toggle: (id) => deps.repo.toggle(id, deps.owner),
  };
}
