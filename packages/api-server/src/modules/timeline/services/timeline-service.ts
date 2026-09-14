import type {
  TimelineLogsQuery,
  TimelineLogsResult,
  TimelineService,
  TimelineSpan,
  TimelineTurnQuery,
  TimelineTurnResult,
  TimelineTurnsQuery,
  TimelineTurnsResult,
  TurnSummary,
} from "api-server-api";

import {
  attachLogsToSpans,
  type UnattachedLog,
} from "../domain/attach-logs.js";
import { groupIntoTurns } from "../domain/group-turns.js";

export const TIMELINE_DISABLED_REASON =
  "The telemetry backend is not enabled on this deployment, so agent traces and logs are not recorded here.";

export interface TimelineWindow {
  hours?: number;
  fromIso?: string;
  toIso?: string;
  sessionId?: string;
}

export interface TimelineLogFilter extends TimelineWindow {
  traceId?: string;
  event?: string;
  contains?: string;
}

export interface TimelineReader {
  sessionSpans(
    agentIds: readonly string[],
    window: TimelineWindow,
    limit: number,
  ): Promise<TimelineSpan[]>;
  logRecords(
    agentIds: readonly string[],
    filter: TimelineLogFilter,
    limit: number,
  ): Promise<UnattachedLog[]>;
}

export interface OwnedAgent {
  id: string;
  name: string | null;
}

export function ownedTimelineScope(
  owned: readonly OwnedAgent[],
  agentId: string | undefined,
): string[] {
  const ids = owned.map((a) => a.id);
  if (!agentId) return ids;
  return ids.includes(agentId) ? [agentId] : [];
}

export function newestTurns(
  turns: readonly TurnSummary[],
  limit: number,
): TurnSummary[] {
  return turns.slice(Math.max(0, turns.length - limit));
}

export function createTimelineService(deps: {
  reader: TimelineReader;
  listOwnedAgents: () => Promise<readonly OwnedAgent[]>;
}): TimelineService {
  return {
    async turns(query: TimelineTurnsQuery): Promise<TimelineTurnsResult> {
      const ids = ownedTimelineScope(
        await deps.listOwnedAgents(),
        query.agentId,
      );
      if (ids.length === 0) {
        return { available: true, turns: [], truncated: false };
      }

      const window: TimelineWindow = {
        hours: query.sinceHours,
        sessionId: query.sessionId,
      };
      const [logs, spans] = await Promise.all([
        deps.reader.logRecords(ids, window, query.logLimit),
        deps.reader.sessionSpans(ids, window, query.spanLimit),
      ]);

      const grouped = groupIntoTurns(logs, spans);
      return {
        available: true,
        turns: newestTurns(grouped, query.limit),
        truncated:
          grouped.length > query.limit ||
          logs.length >= query.logLimit ||
          spans.length >= query.spanLimit,
      };
    },

    async turn(query: TimelineTurnQuery): Promise<TimelineTurnResult> {
      const ids = ownedTimelineScope(
        await deps.listOwnedAgents(),
        query.agentId,
      );
      const window: TimelineWindow = {
        fromIso: query.from,
        toIso: query.to,
        sessionId: query.sessionId,
      };
      const [logs, spans] =
        ids.length === 0
          ? [[] as UnattachedLog[], [] as TimelineSpan[]]
          : await Promise.all([
              deps.reader.logRecords(ids, window, query.logLimit),
              deps.reader.sessionSpans(ids, window, query.spanLimit),
            ]);

      const startedMs = Date.parse(query.from);
      const endedMs = Date.parse(query.to);
      return {
        available: true,
        turn: {
          turnId: query.from,
          startedAt: query.from,
          durationMs:
            Number.isNaN(startedMs) || Number.isNaN(endedMs)
              ? 0
              : Math.max(0, endedMs - startedMs),
          spans,
          logs: attachLogsToSpans(spans, logs),
          spansTruncated: spans.length >= query.spanLimit,
          logsTruncated: logs.length >= query.logLimit,
        },
      };
    },

    async logs(query: TimelineLogsQuery): Promise<TimelineLogsResult> {
      const ids = ownedTimelineScope(
        await deps.listOwnedAgents(),
        query.agentId,
      );
      if (ids.length === 0) {
        return { available: true, records: [], truncated: false };
      }
      const records = await deps.reader.logRecords(
        ids,
        {
          hours: query.sinceHours,
          ...(query.sessionId === undefined
            ? {}
            : { sessionId: query.sessionId }),
          ...(query.traceId === undefined ? {} : { traceId: query.traceId }),
          ...(query.event === undefined ? {} : { event: query.event }),
          ...(query.contains === undefined ? {} : { contains: query.contains }),
        },
        query.limit,
      );
      return {
        available: true,
        records: attachLogsToSpans([], records),
        truncated: records.length >= query.limit,
      };
    },
  };
}

export function createDisabledTimelineService(): TimelineService {
  const unavailable = {
    available: false,
    reason: TIMELINE_DISABLED_REASON,
  } as const;
  return {
    turns: async () => unavailable,
    turn: async () => unavailable,
    logs: async () => unavailable,
  };
}
