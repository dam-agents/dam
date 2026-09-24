import {
  TELEMETRY_MAX_SINCE_HOURS,
  type TelemetryInvocationTurnsQuery,
  type TelemetryInvocationTurnsResult,
  type TelemetryLogsQuery,
  type TelemetryLogsResult,
  type TelemetryService,
  type TelemetrySpan,
  type TelemetryTurnQuery,
  type TelemetryTurnResult,
  type TelemetryTurnsQuery,
  type TelemetryTurnsResult,
  type TurnSummary,
} from "api-server-api";

import {
  attachLogsToSpans,
  type UnattachedLog,
} from "../domain/attach-logs.js";
import {
  BOUNDARY_DEBOUNCE_MS,
  groupIntoTurns,
  summariseRun,
} from "../domain/group-turns.js";

export const TELEMETRY_DISABLED_REASON =
  "The telemetry backend is not enabled on this deployment, so agent traces and logs are not recorded here.";

export interface TelemetryWindow {
  hours?: number;
  fromIso?: string;
  toIso?: string;
  sessionId?: string;
  invocationIds?: readonly string[];
}

export interface TelemetryLogFilter extends TelemetryWindow {
  traceId?: string;
  promptId?: string;
  event?: string;
  contains?: string;
}

const shiftIso = (iso: string, deltaMs: number): string => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms + deltaMs).toISOString();
};

const END_TRUNCATION_MS = 1;
const TELEMETRY_INVOCATION_ROWS = 20_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the window one turn is read through. The listing
 * reports a turn's end at millisecond precision while the store keeps
 * nanoseconds, so a half-open window ending exactly there drops the turn's own
 * last record; every window therefore runs one millisecond past the end it was
 * given, which reaches that record and nothing later — turns are cut seconds
 * apart. A turn addressed by its prompt id is padded further, by the marker
 * slack on both sides: the id already narrows the records to the one turn, so
 * the padding cannot admit a neighbour's, and what it admits is the turn's own
 * root span, which opens a few milliseconds before the first record.
 */
export function turnWindow(query: TelemetryTurnQuery): TelemetryWindow {
  const markerPadMs = query.promptId === undefined ? 0 : BOUNDARY_DEBOUNCE_MS;
  return {
    fromIso: shiftIso(query.from, -markerPadMs),
    toIso: shiftIso(query.to, markerPadMs + END_TRUNCATION_MS),
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
    ...(query.invocationId === undefined
      ? {}
      : { invocationIds: [query.invocationId] }),
  };
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
 * UNIT_BOUNDARY_DESCRIPTION: the one rule that decides which agents a caller may
 * read telemetry for, so every transport resolves the same set. The readable
 * set is the caller's live agents unioned with the ones the owner table still
 * remembers — a deleted agent stays readable while the store retains it —
 * intersected with the key's granted scope, then narrowed to one agent when the
 * caller named one. The narrowing yields an empty allowlist for an agent the
 * caller cannot read, which the caller turns into no rows without a query.
 */
export function scopeOwnedAgentIds(input: {
  liveIds: readonly string[];
  registeredIds: readonly string[];
  granted: readonly string[] | "*";
  agentId?: string;
}): string[] {
  const owned = [...new Set([...input.liveIds, ...input.registeredIds])];
  const scoped =
    input.granted === "*"
      ? owned
      : owned.filter((id) => input.granted.includes(id));
  if (input.agentId === undefined) return scoped;
  return scoped.includes(input.agentId) ? [input.agentId] : [];
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
      const window = turnWindow(query);
      const recordFilter: TelemetryLogFilter =
        query.promptId === undefined
          ? window
          : { ...window, promptId: query.promptId };
      const [logs, spans] =
        ids.length === 0
          ? [[] as UnattachedLog[], [] as TelemetrySpan[]]
          : await Promise.all([
              deps.reader.logRecords(ids, recordFilter, query.logLimit),
              deps.reader.sessionSpans(ids, window, query.spanLimit),
            ]);

      const startedMs = Date.parse(query.from);
      const endedMs = Date.parse(query.to);
      return {
        available: true,
        turn: {
          turnId: query.promptId ?? query.from,
          promptId: query.promptId ?? null,
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

    async invocationTurns(
      query: TelemetryInvocationTurnsQuery,
    ): Promise<TelemetryInvocationTurnsResult> {
      const ids = ownedTelemetryScope(await deps.listOwnedAgents(), undefined);
      if (ids.length === 0) return { available: true, turns: {} };

      const window: TelemetryWindow = {
        hours: TELEMETRY_MAX_SINCE_HOURS,
        invocationIds: query.ids,
      };
      const [logs, spans] = await Promise.all([
        deps.reader.logRecords(ids, window, TELEMETRY_INVOCATION_ROWS),
        deps.reader.sessionSpans(ids, window, TELEMETRY_INVOCATION_ROWS),
      ]);

      const turns: Record<string, TurnSummary> = {};
      for (const id of query.ids) {
        const run = summariseRun(
          id,
          logs.filter((l) => l.invocationId === id),
          spans.filter((sp) => sp.invocationId === id),
        );
        if (run) turns[id] = run;
      }
      return { available: true, turns };
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
    invocationTurns: async () => unavailable,
    logs: async () => unavailable,
  };
}
