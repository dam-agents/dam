import type { ClickHouseClient } from "@clickhouse/client";
import type { TelemetrySpan } from "api-server-api";

import type { UnattachedLog } from "../domain/attach-logs.js";
import type {
  TelemetryLogFilter,
  TelemetryReader,
  TelemetryWindow,
} from "../services/telemetry-service.js";

const OWNER = "ResourceAttributes['platform.agent.id']";
const INVOCATION = "ResourceAttributes['platform.invocation.id']";

const MAX_EXECUTION_SECONDS = 20;
const MAX_ROWS_TO_READ = 200_000_000;

const readGuards = {
  max_execution_time: MAX_EXECUTION_SECONDS,
  max_rows_to_read: String(MAX_ROWS_TO_READ),
  read_overflow_mode: "throw",
} as const;

function windowClauses(w: TelemetryWindow): string[] {
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

export const ownedSpans = (w: TelemetryWindow): string =>
  [
    `${OWNER} IN {agentIds:Array(String)}`,
    ...windowClauses(w),
    ...(w.sessionId === undefined
      ? []
      : ["SpanAttributes['session.id'] = {sessionId:String}"]),
  ].join("\n  AND ");

export const ownedLogs = (f: TelemetryLogFilter): string =>
  [
    `${OWNER} IN {agentIds:Array(String)}`,
    ...windowClauses(f),
    ...(f.traceId === undefined ? [] : ["TraceId = {traceId:String}"]),
    ...(f.sessionId === undefined
      ? []
      : ["LogAttributes['session.id'] = {sessionId:String}"]),
    ...(f.promptId === undefined
      ? []
      : ["LogAttributes['prompt.id'] = {promptId:String}"]),
    ...(f.event === undefined ? [] : ["Body = {event:String}"]),
    ...(f.contains === undefined
      ? []
      : [
          `(positionCaseInsensitiveUTF8(Body, {contains:String}) > 0
   OR arrayExists(v -> positionCaseInsensitiveUTF8(v, {contains:String}) > 0, mapValues(LogAttributes)))`,
        ]),
  ].join("\n  AND ");

const windowParams = (agentIds: readonly string[], w: TelemetryWindow) => ({
  agentIds,
  ...(w.hours === undefined ? {} : { hours: w.hours }),
  ...(w.fromIso === undefined ? {} : { fromIso: w.fromIso }),
  ...(w.toIso === undefined ? {} : { toIso: w.toIso }),
  ...(w.sessionId === undefined ? {} : { sessionId: w.sessionId }),
});

const logParams = (agentIds: readonly string[], f: TelemetryLogFilter) => ({
  ...windowParams(agentIds, f),
  ...(f.traceId === undefined ? {} : { traceId: f.traceId }),
  ...(f.promptId === undefined ? {} : { promptId: f.promptId }),
  ...(f.event === undefined ? {} : { event: f.event }),
  ...(f.contains === undefined ? {} : { contains: f.contains }),
});

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

export function createClickhouseTelemetryReader(
  client: ClickHouseClient,
): TelemetryReader {
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
    async sessionSpans(agentIds, window, limit) {
      const newestFirst = await rows(
        `SELECT
           SpanId AS spanId,
           ParentSpanId AS parentSpanId,
           TraceId AS traceId,
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
         ORDER BY Timestamp DESC
         LIMIT {limit:UInt32}`,
        { ...windowParams(agentIds, window), limit },
      );
      return newestFirst
        .map((x) => ({
          spanId: s(x.spanId),
          parentSpanId: s(x.parentSpanId),
          traceId: s(x.traceId),
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
        }))
        .reverse() satisfies TelemetrySpan[];
    },

    async logRecords(agentIds, filter, limit) {
      const newestFirst = await rows(
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
         ORDER BY Timestamp DESC
         LIMIT {limit:UInt32}`,
        { ...logParams(agentIds, filter), limit },
      );
      return newestFirst
        .map((x) => ({
          at: toIsoUtc(x.at),
          spanId: s(x.spanId),
          traceId: s(x.traceId),
          event: s(x.event),
          severity: s(x.severity),
          service: s(x.service),
          agentId: s(x.agentId),
          invocationId: nullable(x.invocationId),
          attributes: attrs(x.attributes),
        }))
        .reverse() satisfies UnattachedLog[];
    },
  };
}
