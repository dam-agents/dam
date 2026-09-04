import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type {
  CallContext,
  CreditSpend,
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

const windowBounds = (w: MetricsWindow): string[] => [
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

const gate = (row: string, w: MetricsWindow): string =>
  [row, ...windowBounds(w)].join("\n       AND ");

const logAttr = (a: string) => `toInt64OrZero(LogAttributes['${a}'])`;
const spanAttr = (a: string) => `toInt64OrZero(SpanAttributes['${a}'])`;

const claudeCodeCalls = (w: MetricsWindow): string => `
     SELECT
       Timestamp AS ts,
       TraceId AS traceId,
       ResourceAttributes['platform.agent.id'] AS agentId,
       ResourceAttributes['platform.agent.name'] AS agentNameRaw,
       ResourceAttributes['platform.invocation.id'] AS invocationId,
       LogAttributes['session.id'] AS sessionId,
       LogAttributes['model'] AS modelName,
       LogAttributes['request_id'] AS requestIdRaw,
       ${logAttr("input_tokens")} AS tokIn,
       ${logAttr("output_tokens")} AS tokOut,
       ${logAttr("cache_read_tokens")} AS tokCacheR,
       ${logAttr("cache_creation_tokens")} AS tokCacheC,
       ${logAttr("duration_ms")} AS durMs,
       ${logAttr("cost_usd_micros")} / 1e6 AS usd,
       '' AS creditUnit,
       toFloat64(0) AS creditAmount
     FROM otel_logs
     WHERE ${gate("Body = 'claude_code.api_request'", w)}`;

const bobCalls = (w: MetricsWindow): string => `
     SELECT
       Timestamp AS ts,
       TraceId AS traceId,
       ResourceAttributes['platform.agent.id'] AS agentId,
       ResourceAttributes['platform.agent.name'] AS agentNameRaw,
       ResourceAttributes['platform.invocation.id'] AS invocationId,
       SpanAttributes['langfuse.session.id'] AS sessionId,
       coalesce(
         nullIf(SpanAttributes['gen_ai.response.model'], ''),
         SpanAttributes['gen_ai.request.model']) AS modelName,
       '' AS requestIdRaw,
       ${spanAttr("gen_ai.usage.input_tokens")} AS tokIn,
       ${spanAttr("gen_ai.usage.output_tokens")} AS tokOut,
       ${spanAttr("gen_ai.usage.cache_read.input_tokens")} AS tokCacheR,
       ${spanAttr("gen_ai.usage.cache_creation.input_tokens")} AS tokCacheC,
       ${spanAttr("gen_ai.client.operation.duration")} AS durMs,
       toFloat64(0) AS usd,
       'bobcoin' AS creditUnit,
       toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']) AS creditAmount
     FROM otel_traces
     WHERE ${gate("SpanName = 'LLM Generation'", w)}`;

export const callsCte = (w: MetricsWindow): string => {
  const all = `${claudeCodeCalls(w)}
     UNION ALL${bobCalls(w)}`;
  const narrow =
    w.sessionId === undefined
      ? "SELECT * FROM calls_all"
      : `SELECT * FROM calls_all
     WHERE sessionId = {sessionId:String}
        OR sessionId IN (
             SELECT DISTINCT sessionId FROM calls_all
             WHERE sessionId != '' AND traceId IN (
               SELECT DISTINCT traceId FROM calls_all
               WHERE sessionId = {sessionId:String} AND traceId != ''))`;
  return `WITH calls_all AS (${all}
   ),
   calls AS (
     ${narrow}
   )`;
};

const windowParams = (agentIds: readonly string[], w: MetricsWindow) => ({
  agentIds,
  ...(w.hours === undefined ? {} : { hours: w.hours }),
  ...(w.fromIso === undefined ? {} : { fromIso: w.fromIso }),
  ...(w.toIso === undefined ? {} : { toIso: w.toIso }),
  ...(w.sessionId === undefined ? {} : { sessionId: w.sessionId }),
});

const CREDITS = "sumMap([creditUnit], [creditAmount]) AS credits";

const n = (v: unknown): number => Number(v ?? 0);

const credits = (v: unknown): CreditSpend[] => {
  if (!Array.isArray(v)) return [];
  const [units, amounts] = v as [unknown[], unknown[]];
  if (!Array.isArray(units) || !Array.isArray(amounts)) return [];
  return units.flatMap((unit, i) => {
    const amount = n(amounts[i]);
    return unit === "" || amount === 0 ? [] : [{ unit: String(unit), amount }];
  });
};

const one = (unit: unknown, amount: unknown): CreditSpend[] =>
  unit === "" || unit == null || n(amount) === 0
    ? []
    : [{ unit: String(unit), amount: n(amount) }];

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
        `${callsCte(window)}
         SELECT
           modelName AS model,
           count() AS calls,
           sum(tokIn) AS inputTokens,
           sum(tokOut) AS outputTokens,
           sum(tokCacheR) AS cacheReadTokens,
           sum(tokCacheC) AS cacheCreationTokens,
           sum(usd) AS costUsd,
           ${CREDITS},
           sum(durMs) AS durationMs
         FROM calls
         GROUP BY modelName
         ORDER BY costUsd DESC, sum(creditAmount) DESC`,
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
        credits: credits(x.credits),
        durationMs: n(x.durationMs),
      })) satisfies TokenSpendByModel[];
    },

    async spendByAgent(agentIds, window) {
      const r = await rows(
        `${callsCte(window)}
         SELECT
           agentId,
           argMaxIf(agentNameRaw, ts, invocationId = '' AND agentNameRaw != '') AS agentName,
           sum(usd) AS costUsd,
           ${CREDITS}
         FROM calls
         GROUP BY agentId
         ORDER BY costUsd DESC, sum(creditAmount) DESC`,
        windowParams(agentIds, window),
      );
      return r.map((x) => ({
        agentId: String(x.agentId ?? ""),
        agentName: String(x.agentName ?? ""),
        costUsd: n(x.costUsd),
        credits: credits(x.credits),
      })) satisfies SpendByAgent[];
    },

    async spendByDay(agentIds, window, timeZone) {
      const r = await rows(
        `${callsCte(window)}
         SELECT
           toDate(toTimeZone(ts, {timeZone:String})) AS day,
           sum(usd) AS costUsd,
           ${CREDITS}
         FROM calls
         GROUP BY day
         ORDER BY day`,
        { ...windowParams(agentIds, window), timeZone },
      );
      return r.map((x) => ({
        day: String(x.day ?? ""),
        costUsd: n(x.costUsd),
        credits: credits(x.credits),
      })) satisfies SpendByDay[];
    },

    async spendBySession(agentIds, window) {
      const r = await rows(
        `${callsCte(window)},
         trace_root AS (
           SELECT traceId, argMin(sessionId, ts) AS rootSid
           FROM calls_all
           WHERE traceId != '' AND sessionId != ''
           GROUP BY traceId
         ),
         session_root AS (
           SELECT sid, argMin(rootSid, firstAt) AS rootSid
           FROM (
             SELECT sessionId AS sid, traceId, min(ts) AS firstAt
             FROM calls_all
             WHERE traceId != '' AND sessionId != ''
             GROUP BY sid, traceId
           ) AS st
           INNER JOIN trace_root USING (traceId)
           GROUP BY sid
         )
         SELECT
           coalesce(nullIf(rootSid, ''), sid) AS sessionId,
           sum(usd) AS costUsd,
           ${CREDITS}
         FROM (
           SELECT sessionId AS sid, usd, creditUnit, creditAmount
           FROM calls
         ) AS calls_rows
         LEFT JOIN session_root USING (sid)
         GROUP BY sessionId`,
        windowParams(agentIds, window),
      );
      return r.map((x) => ({
        sessionId: String(x.sessionId ?? ""),
        costUsd: n(x.costUsd),
        credits: credits(x.credits),
      })) satisfies SessionSpend[];
    },

    async runtimeBySession(agentIds, window) {
      const r = await rows(
        `${callsCte(window)},
         trace_root AS (
           SELECT traceId, argMin(sessionId, ts) AS rootSid
           FROM calls_all
           WHERE traceId != '' AND sessionId != ''
           GROUP BY traceId
         ),
         session_root AS (
           SELECT sid, argMin(rootSid, firstAt) AS rootSid
           FROM (
             SELECT sessionId AS sid, traceId, min(ts) AS firstAt
             FROM calls_all
             WHERE traceId != '' AND sessionId != ''
             GROUP BY sid, traceId
           ) AS st
           INNER JOIN trace_root USING (traceId)
           GROUP BY sid
         )
         SELECT
           coalesce(nullIf(rootSid, ''), sid) AS sessionId,
           agentId,
           count() AS calls,
           sum(durMs) AS totalDurationMs,
           sum(tokIn) AS inputTokens,
           sum(tokOut) AS outputTokens,
           sum(tokCacheR) AS cacheReadTokens,
           sum(tokCacheC) AS cacheCreationTokens,
           sum(usd) AS costUsd,
           ${CREDITS},
           min(ts) AS firstAt,
           max(ts) AS lastAt
         FROM (
           SELECT
             sessionId AS sid, agentId, ts,
             tokIn, tokOut, tokCacheR, tokCacheC, durMs, usd,
             creditUnit, creditAmount
           FROM calls WHERE sessionId != ''
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
        credits: credits(x.credits),
        firstAt: String(x.firstAt ?? ""),
        lastAt: String(x.lastAt ?? ""),
      })) satisfies SessionRuntime[];
    },

    async contextPerCall(agentIds, window, limit) {
      const r = await rows(
        `${callsCte(window)}
         SELECT
           ts AS at,
           requestIdRaw AS requestId,
           agentId,
           modelName AS model,
           tokIn AS inputTokens,
           tokCacheR AS cacheReadTokens,
           tokCacheC AS cacheCreationTokens,
           tokOut AS outputTokens,
           tokIn + tokCacheR + tokCacheC AS contextTokens,
           usd AS costUsd,
           creditUnit,
           creditAmount,
           durMs AS durationMs
         FROM calls
         ORDER BY ts DESC
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
        credits: one(x.creditUnit, x.creditAmount),
        durationMs: n(x.durationMs),
      })) satisfies CallContext[];
    },

    async close() {
      await client.close();
    },
  };
}
