import { TRPCError } from "@trpc/server";
import type { FeatureMode, Schedule, SchedulesService } from "api-server-api";

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
  mode: FeatureMode;
  enabled: () => Promise<boolean>;
  assistantAgentId: () => Promise<string | null>;
  ownsAgent: (agentId: string) => Promise<boolean>;
  schedules: Pick<
    SchedulesService,
    "get" | "createRRule" | "updateRRule" | "delete"
  >;
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
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
  refresh(): Promise<void>;
  disable(): Promise<void>;
  report(
    items: readonly string[],
    opts?: { update?: boolean },
  ): Promise<AssistantScheduleAlert | null>;
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
 * made where the install turned the feature off, and the alert of a person it
 * is off for is not kept or shown. The Schedule is the owner's from then on:
 * they change its time or delete it, and only `enable` makes one again. Its
 * task stays the platform's: `refresh` puts the definition's current text
 * over whatever the Schedule holds, so a later release's procedure reaches a
 * Schedule made before it. Giving, refreshing and taking away run one at a
 * time per owner, so two requests never make two Schedules.
 */
export function createAssistantSchedule(
  deps: AssistantScheduleDeps,
): AssistantSchedule {
  const { definition, owner } = deps;
  const now = deps.now ?? (() => new Date());
  const serialized = <T>(work: () => Promise<T>): Promise<T> =>
    deps.lock(`assistant-schedule:${definition.kind}:${owner}`, work);

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
    try {
      await deps.repo.save(owner, definition.kind, {
        agentId,
        scheduleId: schedule.id,
      });
    } catch (err) {
      await deps.schedules.delete(schedule.id).catch(() => undefined);
      throw err;
    }
    securityLog("info", "assistant_schedule.enabled", {
      category: "resource",
      actor: owner,
      actorKind: "user",
      agentId,
      result: "success",
      detail: { kind: definition.kind },
    });
  }

  /* UNIT_BOUNDARY_DESCRIPTION: the Schedule `ensure` still owes this person: their assistant has none on record, or the record names another Agent. Null is the common answer, and it is read without the lock, since `ensure` runs on a request path; the lock is taken only to make a Schedule, and this is read again inside it. */
  async function owed(): Promise<{
    row: AssistantScheduleRow | null;
    agentId: string;
  } | null> {
    const [row, agentId] = await Promise.all([
      deps.repo.find(owner, definition.kind),
      deps.assistantAgentId(),
    ]);
    return agentId === null || row?.agentId === agentId
      ? null
      : { row, agentId };
  }

  /* UNIT_BOUNDARY_DESCRIPTION: the Schedule on record when its task is not the definition's current text, read without the lock as `owed` is. The platform gives a recurrence rule and no edit turns one into another kind, so a Schedule of another kind is not the one it gave and is left alone. */
  async function stale(): Promise<Schedule | null> {
    const row = await deps.repo.find(owner, definition.kind);
    if (row === null || row.scheduleId === null) return null;
    const schedule = await deps.schedules.get(row.scheduleId);
    if (schedule === null || schedule.agentId !== row.agentId) return null;
    return schedule.spec.type !== "rrule" ||
      schedule.spec.task === definition.task()
      ? null
      : schedule;
  }

  /* UNIT_BOUNDARY_DESCRIPTION: the task alone is replaced. The name, the recurrence, the timezone and the session mode go back as the Schedule holds them, since the owner may have changed them, and every choice the update leaves out is kept. */
  async function rewriteTask(schedule: Schedule): Promise<void> {
    const { spec } = schedule;
    if (spec.type !== "rrule") return;
    const updated = await deps.schedules.updateRRule({
      id: schedule.id,
      name: schedule.name,
      rrule: spec.rrule,
      timezone: spec.timezone,
      task: definition.task(),
      sessionMode: spec.sessionMode,
    });
    if (updated === null) return;
    securityLog("info", "assistant_schedule.task_refreshed", {
      category: "resource",
      actor: "system:assistant-schedules",
      actorKind: "system",
      agentId: schedule.agentId,
      target: schedule.id,
      result: "success",
      detail: { kind: definition.kind },
    });
  }

  const changed = (agentId: string): void =>
    emit({ type: EventType.AttentionChanged, agentId, ownerSub: owner });

  return {
    async enable() {
      if (deps.mode === "off") return;
      await serialized(async () => {
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
      });
    },

    async ensure() {
      if ((await owed()) === null) return;
      await serialized(async () => {
        const due = await owed();
        if (due === null) return;
        if (due.row?.scheduleId)
          await deps.schedules.delete(due.row.scheduleId);
        await give(due.agentId);
      });
    },

    async refresh() {
      if (deps.mode === "off") return;
      if ((await stale()) === null) return;
      await serialized(async () => {
        const schedule = await stale();
        if (schedule !== null) await rewriteTask(schedule);
      });
    },

    async disable() {
      if (deps.mode === "on") return;
      await serialized(async () => {
        const row = await deps.repo.find(owner, definition.kind);
        if (row === null) return;
        if (row.scheduleId) await deps.schedules.delete(row.scheduleId);
        await deps.repo.delete(owner, definition.kind);
        changed(row.agentId);
      });
    },

    async report(items, opts) {
      if (!(await deps.enabled())) return null;
      const row = await deps.repo.report(owner, definition.kind, items, {
        at: now(),
        keepTime: opts?.update === true,
      });
      if (row === null || row.reportedAt === null) return null;
      changed(row.agentId);
      return toAlert(row, row.reportedAt);
    },

    async current() {
      const row = await deps.repo.find(owner, definition.kind);
      if (row === null || row.reportedAt === null || row.items.length === 0)
        return null;
      const [enabled, owned, stands] = await Promise.all([
        deps.enabled(),
        deps.ownsAgent(row.agentId),
        scheduleStands(row),
      ]);
      return enabled && owned && stands ? toAlert(row, row.reportedAt) : null;
    },
  };
}
