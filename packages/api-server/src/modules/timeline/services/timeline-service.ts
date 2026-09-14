import { TRPCError } from "@trpc/server";
import {
  TIMELINE_MAX_TRACE_HOURS,
  type TimelineLogsQuery,
  type TimelineLogsResult,
  type TimelineService,
  type TimelineSpan,
  type TimelineTraceQuery,
  type TimelineTraceResult,
  type TimelineTracesQuery,
  type TimelineTracesResult,
  type TraceSummary,
} from "api-server-api";

import {
  attachLogsToSpans,
  type UnattachedLog,
} from "../domain/attach-logs.js";

export const TIMELINE_DISABLED_REASON =
  "The telemetry backend is not enabled on this deployment, so agent traces and logs are not recorded here.";

export interface TimelineWindow {
  hours?: number;
  fromIso?: string;
  toIso?: string;
  sessionId?: string;
}

export interface TraceSpend {
  traceId: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface TraceShape {
  traceId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  rootName: string;
  spanCount: number;
  errorCount: number;
  services: string[];
  sessionIds: string[];
  recordCount: number;
}

export interface TimelineLogFilter extends TimelineWindow {
  traceId?: string;
  event?: string;
  contains?: string;
}

export interface TimelineReader {
  traceShapes(
    agentIds: readonly string[],
    window: TimelineWindow,
    limit: number,
  ): Promise<TraceShape[]>;
  logTraceShapes(
    agentIds: readonly string[],
    window: TimelineWindow,
    limit: number,
  ): Promise<TraceShape[]>;
  spendByTrace(
    agentIds: readonly string[],
    window: TimelineWindow,
    traceIds: readonly string[],
  ): Promise<TraceSpend[]>;
  spansForTrace(
    agentIds: readonly string[],
    window: TimelineWindow,
    traceId: string,
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

function detailWindow(query: TimelineTraceQuery): TimelineWindow {
  if (query.startedAt === undefined) return { hours: query.sinceHours };
  const started = Date.parse(query.startedAt);
  if (Number.isNaN(started)) return { hours: query.sinceHours };
  return {
    fromIso: new Date(started - 60_000).toISOString(),
    toIso: new Date(
      started + TIMELINE_MAX_TRACE_HOURS * 60 * 60 * 1000,
    ).toISOString(),
  };
}

export function mergeShapes(
  spanShapes: readonly TraceShape[],
  logShapes: readonly TraceShape[],
): TraceShape[] {
  const merged = new Map<string, TraceShape>();
  for (const shape of logShapes) merged.set(shape.traceId, shape);
  for (const shape of spanShapes) {
    const fromLogs = merged.get(shape.traceId);
    merged.set(
      shape.traceId,
      fromLogs === undefined
        ? shape
        : {
            ...shape,
            startedAt:
              fromLogs.startedAt !== "" && fromLogs.startedAt < shape.startedAt
                ? fromLogs.startedAt
                : shape.startedAt,
            endedAt:
              fromLogs.endedAt > shape.endedAt
                ? fromLogs.endedAt
                : shape.endedAt,
            sessionIds: [
              ...new Set([...shape.sessionIds, ...fromLogs.sessionIds]),
            ],
          },
    );
  }
  return [...merged.values()]
    .map((shape) => ({
      ...shape,
      durationMs: durationBetween(shape.startedAt, shape.endedAt),
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function durationBetween(startedAt: string, endedAt: string): number {
  const from = Date.parse(startedAt);
  const to = Date.parse(endedAt);
  return Number.isNaN(from) || Number.isNaN(to) ? 0 : Math.max(0, to - from);
}

function boundsOf(
  spans: readonly TimelineSpan[],
  logs: readonly UnattachedLog[],
): { startedAt: string; durationMs: number } {
  const starts = [
    ...spans.map((s) => Date.parse(s.startedAt)),
    ...logs.map((l) => Date.parse(l.at)),
  ].filter((n) => !Number.isNaN(n));
  const ends = [
    ...spans.map((s) => Date.parse(s.startedAt) + s.durationMs),
    ...logs.map((l) => Date.parse(l.at)),
  ].filter((n) => !Number.isNaN(n));
  if (starts.length === 0)
    return { startedAt: new Date(0).toISOString(), durationMs: 0 };
  const from = Math.min(...starts);
  return {
    startedAt: new Date(from).toISOString(),
    durationMs: Math.max(0, Math.max(...ends) - from),
  };
}

export function createTimelineService(deps: {
  reader: TimelineReader;
  listOwnedAgents: () => Promise<readonly OwnedAgent[]>;
}): TimelineService {
  return {
    async traces(query: TimelineTracesQuery): Promise<TimelineTracesResult> {
      const ids = ownedTimelineScope(
        await deps.listOwnedAgents(),
        query.agentId,
      );
      if (ids.length === 0)
        return { available: true, traces: [], truncated: false };

      const window: TimelineWindow = {
        hours: query.sinceHours,
        ...(query.sessionId === undefined
          ? {}
          : { sessionId: query.sessionId }),
      };
      const [spanShapes, logShapes] = await Promise.all([
        deps.reader.traceShapes(ids, window, query.limit),
        deps.reader.logTraceShapes(ids, window, query.limit),
      ]);
      const shapes = mergeShapes(spanShapes, logShapes).slice(0, query.limit);
      if (shapes.length === 0) {
        return { available: true, traces: [], truncated: false };
      }

      const spend = await deps.reader.spendByTrace(
        ids,
        window,
        shapes.map((s) => s.traceId),
      );
      const byTrace = new Map(spend.map((s) => [s.traceId, s]));
      const traces: TraceSummary[] = shapes.map((shape) => {
        const s = byTrace.get(shape.traceId);
        return {
          ...shape,
          calls: s?.calls ?? 0,
          costUsd: s?.costUsd ?? 0,
          inputTokens: s?.inputTokens ?? 0,
          outputTokens: s?.outputTokens ?? 0,
          cacheReadTokens: s?.cacheReadTokens ?? 0,
          cacheCreationTokens: s?.cacheCreationTokens ?? 0,
        };
      });
      return {
        available: true,
        traces,
        truncated:
          spanShapes.length >= query.limit || logShapes.length >= query.limit,
      };
    },

    async trace(query: TimelineTraceQuery): Promise<TimelineTraceResult> {
      const ids = ownedTimelineScope(
        await deps.listOwnedAgents(),
        query.agentId,
      );
      if (ids.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found." });
      }
      const window = detailWindow(query);
      const [spans, logs] = await Promise.all([
        deps.reader.spansForTrace(ids, window, query.traceId, query.spanLimit),
        deps.reader.logRecords(
          ids,
          { ...window, traceId: query.traceId },
          query.logLimit,
        ),
      ]);
      if (spans.length === 0 && logs.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found." });
      }
      const { startedAt, durationMs } = boundsOf(spans, logs);
      return {
        available: true,
        trace: {
          traceId: query.traceId,
          startedAt,
          durationMs,
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
    traces: async () => unavailable,
    trace: async () => unavailable,
    logs: async () => unavailable,
  };
}
