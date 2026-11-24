import type {
  FeatureMode,
  SchedulesService,
  SecurityCheckReport,
  SecurityChecksService,
} from "api-server-api";
import type { Db } from "db";

import { createXactLock } from "../../core/xact-lock.js";

import {
  securityCheckRunLevel,
  securityCheckSchedule,
} from "./domain/security-check.js";
import { createAssistantSchedulesRepository } from "./infrastructure/assistant-schedules-repository.js";
import {
  createAssistantSchedule,
  type AssistantScheduleAlert,
} from "./services/assistant-schedule-service.js";

export interface SecurityChecks extends SecurityChecksService {
  ensure(): Promise<void>;
  refresh(): Promise<void>;
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

/* UNIT_BOUNDARY_DESCRIPTION: the owners whose check this replica already brought up to date. The task's text changes only with a release, and a release restarts the replica, so one pass per owner in a replica's life is enough and every later request pays nothing. */
const refreshedOwners = new Set<string>();

/**
 * UNIT_BOUNDARY_DESCRIPTION: the security check for one owner: the shared
 * assistant Schedule service bound to the security check's definition, with
 * its alert read as the report of problems the contract names. A level is
 * read and chosen only by a person the feature is on for; for anyone else
 * the check is off and a choice makes nothing.
 */
export function composeSecurityChecksForOwner(deps: {
  db: Db;
  owner: string;
  assistantName: string;
  mode: FeatureMode;
  enabled: () => Promise<boolean>;
  assistantAgentId: () => Promise<string | null>;
  ownsAgent: (agentId: string) => Promise<boolean>;
  schedules: Pick<
    SchedulesService,
    "get" | "createRRule" | "updateRRule" | "delete"
  >;
}): SecurityChecks {
  const schedule = createAssistantSchedule({
    definition: securityCheckSchedule,
    owner: deps.owner,
    repo: createAssistantSchedulesRepository(deps.db),
    assistantName: deps.assistantName,
    mode: deps.mode,
    enabled: deps.enabled,
    assistantAgentId: deps.assistantAgentId,
    ownsAgent: deps.ownsAgent,
    schedules: deps.schedules,
    lock: createXactLock(deps.db),
  });
  return {
    enable: () => schedule.enable(),
    ensure: () => schedule.ensure(),
    refresh: async () => {
      if (refreshedOwners.has(deps.owner)) return;
      await schedule.refresh();
      refreshedOwners.add(deps.owner);
    },
    disable: () => schedule.disable(),
    level: async () => {
      if (!(await deps.enabled())) return "off";
      const level = await schedule.level();
      return level === null ? "off" : securityCheckRunLevel(level);
    },
    setLevel: async (level) => {
      if (!(await deps.enabled())) return;
      if (level === "off") await schedule.stop();
      else await schedule.enable(level);
    },
    report: async (input) =>
      toReport(await schedule.report(input.problems, { update: input.update })),
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
