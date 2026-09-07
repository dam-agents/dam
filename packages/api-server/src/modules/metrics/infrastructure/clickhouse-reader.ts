import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type {
  CallContext,
  SessionRuntime,
  SpendByAgent,
  SpendByDay,
  TokenSpendByModel,
} from "api-server-api";
import type {
  MetricsReader,
  MetricsWindow,
  SessionSpend,
} from "../services/metrics-service.js";

export function createClickhouseClient(cfg: {
  url: string;
  username: string;
  password: string;
  database: string;
}): ClickHouseClient {
  return createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
  });
}

export const ownedApiRequests = (w: MetricsWindow): string => {
  const base = [
    "Body = 'claude_code.api_request'",
    "ResourceAttributes['platform.agent.id'] IN {agentIds:Array(String)}",
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
  if (w.sessionId === undefined) return base.join("\n  AND ");
  const owned = base.join(" AND ");
  return [
    ...base,
    `(LogAttributes['session.id'] = {sessionId:String}
   OR LogAttributes['session.id'] IN (
     SELECT DISTINCT LogAttributes['session.id'] FROM otel_logs
     WHERE ${owned} AND LogAttributes['session.id'] != '' AND TraceId IN (
       SELECT DISTINCT TraceId FROM otel_logs
       WHERE ${owned}
         AND LogAttributes['session.id'] = {sessionId:String}
         AND TraceId != '')))`,
  ].join("\n  AND ");
};

const windowParams = (agentIds: readonly string[], w: MetricsWindow) => ({
  agentIds,
  ...(w.hours === undefined ? {} : { hours: w.hours }),
  ...(w.fromIso === undefined ? {} : { fromIso: w.fromIso }),
  ...(w.toIso === undefined ? {} : { toIso: w.toIso }),
  ...(w.sessionId === undefined ? {} : { sessionId: w.sessionId }),
});

const IN = (a: string) => `toInt64OrZero(LogAttributes[${a}])`;
const TOK_IN = IN("'input_tokens'");
const TOK_CACHE_R = IN("'cache_read_tokens'");
const TOK_CACHE_C = IN("'cache_creation_tokens'");
const COST_USD = `${IN("'cost_usd_micros'")} / 1e6`;

const n = (v: unknown): number => Number(v ?? 0);

export function createClickhouseReader(
  client: ClickHouseClient,
): MetricsReader {
  const rows = async (
    query: string,
    query_params: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> => {
    const rs = await client.query({
      query,
      query_params,
      format: "JSONEachRow",
    });
    return rs.json();
  };

  return {
    async tokenSpendByModel(agentIds, window) {
      const r = await rows(
        `SELECT
           LogAttributes['model'] AS model,
           count() AS calls,
           sum(${TOK_IN}) AS inputTokens,
           sum(${IN("'output_tokens'")}) AS outputTokens,
           sum(${TOK_CACHE_R}) AS cacheReadTokens,
           sum(${TOK_CACHE_C}) AS cacheCreationTokens,
           sum(${COST_USD}) AS costUsd,
           sum(${IN("'duration_ms'")}) AS durationMs
         FROM otel_logs
         WHERE ${ownedApiRequests(window)}
         GROUP BY model
         ORDER BY costUsd DESC`,
        windowParams(agentIds, window),
      );
      return r.map((x) => ({
        model: String(x.model ?? ""),
        calls: n(x.calls),
        inputTokens: n(x.inputTokens),
        outputTokens: n(x.outputTokens),
        cacheReadTokens: n(x.cacheReadTokens),
        cacheCreationTokens: n(x.cacheCreationTokens),
        costUsd: n(x.costUsd),
        durationMs: n(x.durationMs),
      })) satisfies TokenSpendByModel[];
    },

    async spendByAgent(agentIds, window) {
      const r = await rows(
        `SELECT
           ResourceAttributes['platform.agent.id'] AS agentId,
           argMaxIf(ResourceAttributes['platform.agent.name'], Timestamp, ResourceAttributes['platform.invocation.id'] = '') AS agentName,
           sum(${COST_USD}) AS costUsd
         FROM otel_logs
         WHERE ${ownedApiRequests(window)}
         GROUP BY agentId
         ORDER BY costUsd DESC`,
        windowParams(agentIds, window),
      );
      return r.map((x) => ({
        agentId: String(x.agentId ?? ""),
        agentName: String(x.agentName ?? ""),
        costUsd: n(x.costUsd),
      })) satisfies SpendByAgent[];
    },

    async spendByDay(agentIds, window, timeZone) {
      const r = await rows(
        `SELECT
           toDate(toTimeZone(Timestamp, {timeZone:String})) AS day,
           sum(${COST_USD}) AS costUsd
         FROM otel_logs
         WHERE ${ownedApiRequests(window)}
         GROUP BY day
         ORDER BY day`,
        { ...windowParams(agentIds, window), timeZone },
      );
      return r.map((x) => ({
        day: String(x.day ?? ""),
        costUsd: n(x.costUsd),
      })) satisfies SpendByDay[];
    },

    async spendBySession(agentIds, window) {
      const base = ownedApiRequests({ ...window, sessionId: undefined });
      const r = await rows(
        `WITH trace_root AS (
           SELECT TraceId,
                  argMin(LogAttributes['session.id'], Timestamp) AS rootSid
           FROM otel_logs
           WHERE ${base} AND TraceId != '' AND LogAttributes['session.id'] != ''
           GROUP BY TraceId
         ),
         session_root AS (
           SELECT sid, argMin(rootSid, firstAt) AS rootSid
           FROM (
             SELECT LogAttributes['session.id'] AS sid,
                    TraceId,
                    min(Timestamp) AS firstAt
             FROM otel_logs
             WHERE ${base} AND TraceId != '' AND LogAttributes['session.id'] != ''
             GROUP BY sid, TraceId
           ) AS st
           INNER JOIN trace_root USING (TraceId)
           GROUP BY sid
         )
         SELECT
           coalesce(nullIf(rootSid, ''), sid) AS sessionId,
           sum(rowCostUsd) AS costUsd
         FROM (
           SELECT
             LogAttributes['session.id'] AS sid,
             ${COST_USD} AS rowCostUsd
           FROM otel_logs
           WHERE ${ownedApiRequests(window)}
         ) AS calls_rows
         LEFT JOIN session_root USING (sid)
         GROUP BY sessionId`,
        windowParams(agentIds, window),
      );
      return r.map((x) => ({
        sessionId: String(x.sessionId ?? ""),
        costUsd: n(x.costUsd),
      })) satisfies SessionSpend[];
    },

    async runtimeBySession(agentIds, window) {
      const base = ownedApiRequests({ ...window, sessionId: undefined });
      const r = await rows(
        `WITH trace_root AS (
           SELECT TraceId,
                  argMin(LogAttributes['session.id'], Timestamp) AS rootSid
           FROM otel_logs
           WHERE ${base} AND TraceId != '' AND LogAttributes['session.id'] != ''
           GROUP BY TraceId
         ),
         session_root AS (
           SELECT sid, argMin(rootSid, firstAt) AS rootSid
           FROM (
             SELECT LogAttributes['session.id'] AS sid,
                    TraceId,
                    min(Timestamp) AS firstAt
             FROM otel_logs
             WHERE ${base} AND TraceId != '' AND LogAttributes['session.id'] != ''
             GROUP BY sid, TraceId
           ) AS st
           INNER JOIN trace_root USING (TraceId)
           GROUP BY sid
         )
         SELECT
           coalesce(nullIf(rootSid, ''), sid) AS sessionId,
           agentId,
           count() AS calls,
           sum(durationMs) AS totalDurationMs,
           sum(rowInputTokens) AS inputTokens,
           sum(rowOutputTokens) AS outputTokens,
           sum(rowCacheReadTokens) AS cacheReadTokens,
           sum(rowCacheCreationTokens) AS cacheCreationTokens,
           sum(rowCostUsd) AS costUsd,
           min(ts) AS firstAt,
           max(ts) AS lastAt
         FROM (
           SELECT
             LogAttributes['session.id'] AS sid,
             ResourceAttributes['platform.agent.id'] AS agentId,
             ${IN("'duration_ms'")} AS durationMs,
             ${TOK_IN} AS rowInputTokens,
             ${IN("'output_tokens'")} AS rowOutputTokens,
             ${TOK_CACHE_R} AS rowCacheReadTokens,
             ${TOK_CACHE_C} AS rowCacheCreationTokens,
             ${COST_USD} AS rowCostUsd,
             Timestamp AS ts
           FROM otel_logs
           WHERE ${ownedApiRequests(window)} AND LogAttributes['session.id'] != ''
         ) AS calls_rows
         LEFT JOIN session_root USING (sid)
         GROUP BY sessionId, agentId
         ORDER BY lastAt DESC`,
        windowParams(agentIds, window),
      );
      return r.map((x) => ({
        sessionId: String(x.sessionId ?? ""),
        agentId: String(x.agentId ?? ""),
        calls: n(x.calls),
        totalDurationMs: n(x.totalDurationMs),
        inputTokens: n(x.inputTokens),
        outputTokens: n(x.outputTokens),
        cacheReadTokens: n(x.cacheReadTokens),
        cacheCreationTokens: n(x.cacheCreationTokens),
        costUsd: n(x.costUsd),
        firstAt: String(x.firstAt ?? ""),
        lastAt: String(x.lastAt ?? ""),
      })) satisfies SessionRuntime[];
    },

    async contextPerCall(agentIds, window, limit) {
      const r = await rows(
        `SELECT
           Timestamp AS at,
           LogAttributes['request_id'] AS requestId,
           ResourceAttributes['platform.agent.id'] AS agentId,
           LogAttributes['model'] AS model,
           ${TOK_IN} AS inputTokens,
           ${TOK_CACHE_R} AS cacheReadTokens,
           ${TOK_CACHE_C} AS cacheCreationTokens,
           ${IN("'output_tokens'")} AS outputTokens,
           ${TOK_IN} + ${TOK_CACHE_R} + ${TOK_CACHE_C} AS contextTokens,
           ${COST_USD} AS costUsd,
           ${IN("'duration_ms'")} AS durationMs
         FROM otel_logs
         WHERE ${ownedApiRequests(window)}
         ORDER BY Timestamp DESC
         LIMIT {limit:UInt32}`,
        { ...windowParams(agentIds, window), limit },
      );
      return r.map((x) => ({
        at: String(x.at ?? ""),
        requestId: String(x.requestId ?? ""),
        agentId: String(x.agentId ?? ""),
        model: String(x.model ?? ""),
        inputTokens: n(x.inputTokens),
        cacheReadTokens: n(x.cacheReadTokens),
        cacheCreationTokens: n(x.cacheCreationTokens),
        outputTokens: n(x.outputTokens),
        contextTokens: n(x.contextTokens),
        costUsd: n(x.costUsd),
        durationMs: n(x.durationMs),
      })) satisfies CallContext[];
    },

    async close() {
      await client.close();
    },
  };
}
