import { TRPCError } from "@trpc/server";
import type { SchedulesService } from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import type { AssistantScheduleDefinition } from "../domain/assistant-schedule.js";
import type {
  AssistantScheduleRow,
  AssistantSchedulesRepository,
} from "../infrastructure/assistant-schedules-repository.js";

export interface AssistantScheduleDeps {
  definition: AssistantScheduleDefinition;
  owner: string;
  repo: AssistantSchedulesRepository;
  assistantName: string;
  enabled: () => Promise<boolean>;
  assistantAgentId: () => Promise<string | null>;
  ownsAgent: (agentId: string) => Promise<boolean>;
  schedules: Pick<SchedulesService, "get" | "createRRule" | "delete">;
  now?: () => Date;
}

export interface AssistantScheduleAlert {
  agentId: string;
  scheduleId: string | null;
  items: string[];
  reportedAt: string;
}

export interface AssistantSchedule {
  enable(): Promise<void>;
  ensure(): Promise<void>;
  disable(): Promise<void>;
  report(items: readonly string[]): Promise<AssistantScheduleAlert | null>;
  current(): Promise<AssistantScheduleAlert | null>;
}

const toAlert = (
  row: AssistantScheduleRow,
  reportedAt: Date,
): AssistantScheduleAlert => ({
  agentId: row.agentId,
  scheduleId: row.scheduleId,
  items: row.items,
  reportedAt: reportedAt.toISOString(),
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: one kind of Schedule the platform gives one
 * owner's assistant, and the alert its runs raise. The platform only makes an
 * ordinary Schedule and keeps the last alert; the assistant does the work and
 * says what it found. A run spends the owner's model budget, so nothing is
 * made before the feature is on for them, and the alert of a person it is off
 * for is not kept or shown. The Schedule is the owner's from then on: they
 * change its time or delete it, and only `enable` makes one again.
 */
export function createAssistantSchedule(
  deps: AssistantScheduleDeps,
): AssistantSchedule {
  const { definition, owner } = deps;
  const now = deps.now ?? (() => new Date());

  async function scheduleStands(row: AssistantScheduleRow): Promise<boolean> {
    if (row.scheduleId === null) return false;
    const schedule = await deps.schedules.get(row.scheduleId);
    return schedule !== null && schedule.agentId === row.agentId;
  }

  async function give(agentId: string): Promise<void> {
    const schedule = await deps.schedules.createRRule({
      name: definition.name,
      agentId,
      rrule: definition.rule(owner),
      timezone: definition.timezone,
      task: definition.task(),
      sessionMode: "fresh",
      sessionTitle: definition.sessionTitle,
    });
    await deps.repo.save(owner, definition.kind, {
      agentId,
      scheduleId: schedule.id,
    });
    securityLog("info", "assistant_schedule.enabled", {
      category: "resource",
      actor: owner,
      actorKind: "user",
      agentId,
      result: "success",
      detail: { kind: definition.kind },
    });
  }

  const changed = (agentId: string): void =>
    emit({ type: EventType.AttentionChanged, agentId, ownerSub: owner });

  return {
    async enable() {
      const agentId = await deps.assistantAgentId();
      if (agentId === null)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `The ${definition.subject} runs on ${deps.assistantName}, and you have none. Turn ${deps.assistantName} on first.`,
        });
      const row = await deps.repo.find(owner, definition.kind);
      if (row?.agentId === agentId && (await scheduleStands(row))) return;
      if (row?.scheduleId) await deps.schedules.delete(row.scheduleId);
      await give(agentId);
    },

    async ensure() {
      if ((await deps.repo.find(owner, definition.kind)) !== null) return;
      const agentId = await deps.assistantAgentId();
      if (agentId !== null) await give(agentId);
    },

    async disable() {
      const row = await deps.repo.find(owner, definition.kind);
      if (row === null) return;
      if (row.scheduleId) await deps.schedules.delete(row.scheduleId);
      await deps.repo.delete(owner, definition.kind);
      changed(row.agentId);
    },

    async report(items) {
      if (!(await deps.enabled())) return null;
      const at = now();
      const row = await deps.repo.report(owner, definition.kind, items, at);
      if (row === null) return null;
      changed(row.agentId);
      return toAlert(row, at);
    },

    async current() {
      if (!(await deps.enabled())) return null;
      const row = await deps.repo.find(owner, definition.kind);
      if (row === null || row.reportedAt === null || row.items.length === 0)
        return null;
      if (!(await deps.ownsAgent(row.agentId))) return null;
      return toAlert(row, row.reportedAt);
    },
  };
}
