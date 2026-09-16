import type {
  TelemetryLogsQuery,
  TelemetryLogsResult,
  TelemetryService,
  TelemetrySpan,
  TelemetryTurnQuery,
  TelemetryTurnResult,
  TelemetryTurnsQuery,
  TelemetryTurnsResult,
  TurnSummary,
} from "api-server-api";

import {
  attachLogsToSpans,
  type UnattachedLog,
} from "../domain/attach-logs.js";
import { groupIntoTurns } from "../domain/group-turns.js";

export const TELEMETRY_DISABLED_REASON =
  "The telemetry backend is not enabled on this deployment, so agent traces and logs are not recorded here.";

export interface TelemetryWindow {
  hours?: number;
  fromIso?: string;
  toIso?: string;
  sessionId?: string;
}

export interface TelemetryLogFilter extends TelemetryWindow {
  traceId?: string;
  event?: string;
  contains?: string;
}

export interface TelemetryReader {
  sessionSpans(
    agentIds: readonly string[],
    window: TelemetryWindow,
    limit: number,
  ): Promise<TelemetrySpan[]>;
  logRecords(
    agentIds: readonly string[],
    filter: TelemetryLogFilter,
    limit: number,
  ): Promise<UnattachedLog[]>;
}

export interface OwnedAgent {
  id: string;
  name: string | null;
}

export function ownedTelemetryScope(
  owned: readonly OwnedAgent[],
  agentId: string | undefined,
): string[] {
  const ids = owned.map((a) => a.id);
  if (!agentId) return ids;
  return ids.includes(agentId) ? [agentId] : [];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: session housekeeping records — a connection
 * opening, a sweep — are not an exchange, and listing them as turns puts rows
 * in front of the reader that no message in the conversation corresponds to.
 */
export function isExchange(turn: TurnSummary): boolean {
  return turn.calls > 0 || turn.spanCount > 0 || turn.errorCount > 0;
}

export function newestTurns(
  turns: readonly TurnSummary[],
  limit: number,
): TurnSummary[] {
  return turns.slice(Math.max(0, turns.length - limit));
}

export function createTelemetryService(deps: {
  reader: TelemetryReader;
  listOwnedAgents: () => Promise<readonly OwnedAgent[]>;
}): TelemetryService {
  return {
    async turns(query: TelemetryTurnsQuery): Promise<TelemetryTurnsResult> {
      const ids = ownedTelemetryScope(
        await deps.listOwnedAgents(),
        query.agentId,
      );
      if (ids.length === 0) {
        return { available: true, turns: [], truncated: false };
      }

      const window: TelemetryWindow = {
        hours: query.sinceHours,
        sessionId: query.sessionId,
      };
      const [logs, spans] = await Promise.all([
        deps.reader.logRecords(ids, window, query.logLimit),
        deps.reader.sessionSpans(ids, window, query.spanLimit),
      ]);

      const grouped = groupIntoTurns(logs, spans).filter(isExchange);
      return {
        available: true,
        turns: newestTurns(grouped, query.limit),
        truncated:
          grouped.length > query.limit ||
          logs.length >= query.logLimit ||
          spans.length >= query.spanLimit,
      };
    },

    async turn(query: TelemetryTurnQuery): Promise<TelemetryTurnResult> {
      const ids = ownedTelemetryScope(
        await deps.listOwnedAgents(),
        query.agentId,
      );
      const window: TelemetryWindow = {
        fromIso: query.from,
        toIso: query.to,
        sessionId: query.sessionId,
      };
      const [logs, spans] =
        ids.length === 0
          ? [[] as UnattachedLog[], [] as TelemetrySpan[]]
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

    async logs(query: TelemetryLogsQuery): Promise<TelemetryLogsResult> {
      const ids = ownedTelemetryScope(
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

export function createDisabledTelemetryService(): TelemetryService {
  const unavailable = {
    available: false,
    reason: TELEMETRY_DISABLED_REASON,
  } as const;
  return {
    turns: async () => unavailable,
    turn: async () => unavailable,
    logs: async () => unavailable,
  };
}
