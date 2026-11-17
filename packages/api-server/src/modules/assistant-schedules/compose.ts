import type {
  SchedulesService,
  SecurityCheckReport,
  SecurityChecksService,
} from "api-server-api";
import type { Db } from "db";

import { securityCheckSchedule } from "./domain/security-check.js";
import { createAssistantSchedulesRepository } from "./infrastructure/assistant-schedules-repository.js";
import {
  createAssistantSchedule,
  type AssistantScheduleAlert,
} from "./services/assistant-schedule-service.js";

export interface SecurityChecks extends SecurityChecksService {
  ensure(): Promise<void>;
  current(): Promise<SecurityCheckReport | null>;
}

const toReport = (
  alert: AssistantScheduleAlert | null,
): SecurityCheckReport | null =>
  alert === null
    ? null
    : {
        agentId: alert.agentId,
        scheduleId: alert.scheduleId,
        problems: alert.items,
        reportedAt: alert.reportedAt,
      };

/**
 * UNIT_BOUNDARY_DESCRIPTION: the security check for one owner: the shared
 * assistant Schedule service bound to the security check's definition, with
 * its alert read as the report of problems the contract names.
 */
export function composeSecurityChecksForOwner(deps: {
  db: Db;
  owner: string;
  assistantName: string;
  enabled: () => Promise<boolean>;
  assistantAgentId: () => Promise<string | null>;
  ownsAgent: (agentId: string) => Promise<boolean>;
  schedules: Pick<SchedulesService, "get" | "createRRule" | "delete">;
}): SecurityChecks {
  const schedule = createAssistantSchedule({
    definition: securityCheckSchedule,
    owner: deps.owner,
    repo: createAssistantSchedulesRepository(deps.db),
    assistantName: deps.assistantName,
    enabled: deps.enabled,
    assistantAgentId: deps.assistantAgentId,
    ownsAgent: deps.ownsAgent,
    schedules: deps.schedules,
  });
  return {
    enable: () => schedule.enable(),
    ensure: () => schedule.ensure(),
    disable: () => schedule.disable(),
    report: async (input) => toReport(await schedule.report(input.problems)),
    current: async () => toReport(await schedule.current()),
  };
}

export function createAssistantSchedulesCleanup(db: Db): {
  listAgentIds(): Promise<string[]>;
  cleanup(agentId: string): Promise<void>;
} {
  const repo = createAssistantSchedulesRepository(db);
  return {
    listAgentIds: () => repo.listAgentIds(),
    cleanup: (agentId) => repo.deleteForAgent(agentId),
  };
}
