import type { ClickHouseClient } from "@clickhouse/client";
import type { TimelineSpan } from "api-server-api";

import type { UnattachedLog } from "../domain/attach-logs.js";
import type {
  TimelineLogFilter,
  TimelineReader,
  TimelineWindow,
  TraceShape,
  TraceSpend,
} from "../services/timeline-service.js";

const OWNER = "ResourceAttributes['platform.agent.id']";
const INVOCATION = "ResourceAttributes['platform.invocation.id']";

const MAX_EXECUTION_SECONDS = 20;
const MAX_ROWS_TO_READ = 200_000_000;

const readGuards = {
  max_execution_time: MAX_EXECUTION_SECONDS,
  max_rows_to_read: String(MAX_ROWS_TO_READ),
  read_overflow_mode: "throw",
} as const;

function windowClauses(w: TimelineWindow): string[] {
  return [
    ...(w.hours === undefined
      ? []
      : ["Timestamp >= now() - toIntervalHour({hours:UInt32})"]),
    ...(w.fromIso === undefined
      ? []
      : ["Timestamp >= parseDateTimeBestEffort({fromIso:String})"]),
    ...(w.toIso === undefined
      ? []
      : ["Timestamp < parseDateTimeBestEffort({toIso:String})"]),
  ];
}

export const ownedSpans = (w: TimelineWindow): string =>
  [`${OWNER} IN {agentIds:Array(String)}`, ...windowClauses(w)].join(
    "\n  AND ",
  );

export const ownedLogs = (f: TimelineLogFilter): string =>
  [
    `${OWNER} IN {agentIds:Array(String)}`,
    ...windowClauses(f),
    ...(f.traceId === undefined ? [] : ["TraceId = {traceId:String}"]),
    ...(f.sessionId === undefined
      ? []
      : ["LogAttributes['session.id'] = {sessionId:String}"]),
    ...(f.event === undefined ? [] : ["Body = {event:String}"]),
    ...(f.contains === undefined
      ? []
      : [
          `(positionCaseInsensitiveUTF8(Body, {contains:String}) > 0
   OR arrayExists(v -> positionCaseInsensitiveUTF8(v, {contains:String}) > 0, mapValues(LogAttributes)))`,
        ]),
  ].join("\n  AND ");

const windowParams = (agentIds: readonly string[], w: TimelineWindow) => ({
  agentIds,
  ...(w.hours === undefined ? {} : { hours: w.hours }),
  ...(w.fromIso === undefined ? {} : { fromIso: w.fromIso }),
  ...(w.toIso === undefined ? {} : { toIso: w.toIso }),
  ...(w.sessionId === undefined ? {} : { sessionId: w.sessionId }),
});

const logParams = (agentIds: readonly string[], f: TimelineLogFilter) => ({
  ...windowParams(agentIds, f),
  ...(f.traceId === undefined ? {} : { traceId: f.traceId }),
  ...(f.event === undefined ? {} : { event: f.event }),
  ...(f.contains === undefined ? {} : { contains: f.contains }),
});

const TOK = (a: string) => `toInt64OrZero(LogAttributes['${a}'])`;
const COST_USD = `${TOK("cost_usd_micros")} / 1e6`;

const n = (v: unknown): number => Number(v ?? 0);
const s = (v: unknown): string => String(v ?? "");

const CLICKHOUSE_NAIVE =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

export const toIsoUtc = (v: unknown): string => {
  const raw = s(v).trim();
  if (raw === "") return raw;
  const naive = CLICKHOUSE_NAIVE.exec(raw);
  return naive ? `${naive[1]}T${naive[2]}Z` : raw;
};
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(s).filter((x) => x !== "") : [];
const attrs = (v: unknown): Record<string, string> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, s(x)]),
      )
    : {};
const nullable = (v: unknown): string | null => {
  const value = s(v);
  return value === "" ? null : value;
};

export function createClickhouseTimelineReader(
  client: ClickHouseClient,
): TimelineReader {
  const rows = async (
    query: string,
    query_params: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> => {
    const rs = await client.query({
      query,
      query_params,
      format: "JSONEachRow",
      clickhouse_settings: readGuards,
    });
    return rs.json();
  };

  return {
    async traceShapes(agentIds, window, limit) {
      const sessionFilter =
        window.sessionId === undefined
          ? ""
          : "\n         HAVING has(sessionIds, {sessionId:String})";
      const r = await rows(
        `SELECT
           TraceId AS traceId,
           min(Timestamp) AS startedAt,
           max(Timestamp + toIntervalNanosecond(Duration)) AS endedAt,
           count() AS spanCount,
           countIf(position(StatusCode, 'ERROR') > 0 OR StatusCode = 'Error') AS errorCount,
           coalesce(
             nullIf(toString(argMinIf(SpanName, Timestamp, ParentSpanId = '')), ''),
             toString(argMin(SpanName, Timestamp))
           ) AS rootName,
           arrayFilter(x -> x != '', groupUniqArray(10)(toString(ServiceName))) AS services,
           arrayFilter(x -> x != '', groupUniqArray(10)(SpanAttributes['session.id'])) AS sessionIds
         FROM otel_traces
         WHERE ${ownedSpans({ ...window, sessionId: undefined })}
         GROUP BY TraceId${sessionFilter}
         ORDER BY startedAt DESC
         LIMIT {limit:UInt32}`,
        { ...windowParams(agentIds, window), limit },
      );
      return r.map((x) => {
        const startedAt = toIsoUtc(x.startedAt);
        const endedAt = toIsoUtc(x.endedAt);
        const from = Date.parse(startedAt);
        const to = Date.parse(endedAt);
        return {
          traceId: s(x.traceId),
          startedAt,
          endedAt,
          durationMs:
            Number.isNaN(from) || Number.isNaN(to) ? 0 : Math.max(0, to - from),
          rootName: s(x.rootName),
          spanCount: n(x.spanCount),
          errorCount: n(x.errorCount),
          services: list(x.services),
          sessionIds: list(x.sessionIds),
          recordCount: 0,
        };
      }) satisfies TraceShape[];
    },

    async logTraceShapes(agentIds, window, limit) {
      const r = await rows(
        `SELECT
           TraceId AS traceId,
           min(Timestamp) AS startedAt,
           max(Timestamp) AS endedAt,
           count() AS spanCount,
           argMin(Body, Timestamp) AS rootName,
           arrayFilter(x -> x != '', groupUniqArray(10)(toString(ServiceName))) AS services,
           arrayFilter(x -> x != '', groupUniqArray(10)(LogAttributes['session.id'])) AS sessionIds
         FROM otel_logs
         WHERE ${ownedLogs(window)}
           AND TraceId != ''
         GROUP BY TraceId
         ORDER BY startedAt DESC
         LIMIT {limit:UInt32}`,
        { ...logParams(agentIds, window), limit },
      );
      return r.map((x) => ({
        traceId: s(x.traceId),
        startedAt: toIsoUtc(x.startedAt),
        endedAt: toIsoUtc(x.endedAt),
        durationMs: 0,
        rootName: s(x.rootName),
        spanCount: 0,
        errorCount: 0,
        services: list(x.services),
        sessionIds: list(x.sessionIds),
        recordCount: n(x.spanCount),
      })) satisfies TraceShape[];
    },

    async spendByTrace(agentIds, window, traceIds) {
      if (traceIds.length === 0) return [];
      const r = await rows(
        `SELECT
           TraceId AS traceId,
           count() AS calls,
           sum(${COST_USD}) AS costUsd,
           sum(${TOK("input_tokens")}) AS inputTokens,
           sum(${TOK("output_tokens")}) AS outputTokens,
           sum(${TOK("cache_read_tokens")}) AS cacheReadTokens,
           sum(${TOK("cache_creation_tokens")}) AS cacheCreationTokens
         FROM otel_logs
         WHERE ${ownedLogs({ ...window, sessionId: undefined })}
           AND Body = 'claude_code.api_request'
           AND TraceId IN {traceIds:Array(String)}
         GROUP BY TraceId`,
        { ...windowParams(agentIds, window), traceIds },
      );
      return r.map((x) => ({
        traceId: s(x.traceId),
        calls: n(x.calls),
        costUsd: n(x.costUsd),
        inputTokens: n(x.inputTokens),
        outputTokens: n(x.outputTokens),
        cacheReadTokens: n(x.cacheReadTokens),
        cacheCreationTokens: n(x.cacheCreationTokens),
      })) satisfies TraceSpend[];
    },

    async spansForTrace(agentIds, window, traceId, limit) {
      const r = await rows(
        `SELECT
           SpanId AS spanId,
           ParentSpanId AS parentSpanId,
           toString(SpanName) AS name,
           toString(SpanKind) AS kind,
           toString(ServiceName) AS service,
           Timestamp AS startedAt,
           Duration AS durationNs,
           toString(StatusCode) AS statusCode,
           StatusMessage AS statusMessage,
           ${OWNER} AS agentId,
           ${INVOCATION} AS invocationId,
           SpanAttributes AS attributes
         FROM otel_traces
         WHERE ${ownedSpans(window)}
           AND TraceId = {traceId:String}
         ORDER BY Timestamp
         LIMIT {limit:UInt32}`,
        { ...windowParams(agentIds, window), traceId, limit },
      );
      return r.map((x) => ({
        spanId: s(x.spanId),
        parentSpanId: s(x.parentSpanId),
        name: s(x.name),
        kind: s(x.kind),
        service: s(x.service),
        startedAt: toIsoUtc(x.startedAt),
        durationMs: n(x.durationNs) / 1e6,
        statusCode: s(x.statusCode),
        statusMessage: s(x.statusMessage),
        agentId: s(x.agentId),
        invocationId: nullable(x.invocationId),
        attributes: attrs(x.attributes),
      })) satisfies TimelineSpan[];
    },

    async logRecords(agentIds, filter, limit) {
      const r = await rows(
        `SELECT
           Timestamp AS at,
           SpanId AS spanId,
           TraceId AS traceId,
           Body AS event,
           toString(SeverityText) AS severity,
           toString(ServiceName) AS service,
           ${OWNER} AS agentId,
           ${INVOCATION} AS invocationId,
           LogAttributes AS attributes
         FROM otel_logs
         WHERE ${ownedLogs(filter)}
         ORDER BY Timestamp
         LIMIT {limit:UInt32}`,
        { ...logParams(agentIds, filter), limit },
      );
      return r.map((x) => ({
        at: toIsoUtc(x.at),
        spanId: s(x.spanId),
        traceId: s(x.traceId),
        event: s(x.event),
        severity: s(x.severity),
        service: s(x.service),
        agentId: s(x.agentId),
        invocationId: nullable(x.invocationId),
        attributes: attrs(x.attributes),
      })) satisfies UnattachedLog[];
    },
  };
}
