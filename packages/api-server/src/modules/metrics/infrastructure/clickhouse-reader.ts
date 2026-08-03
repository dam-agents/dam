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

// Claude Code exports one `claude_code.api_request` OTel *log* record per LLM
// call into `otel_logs`; all counters live in the LogAttributes string map and
// the trusted owner id in ResourceAttributes (stamped by the agent gateway —
// see docs/architecture/observability.md). Every query is gated on that owner
// id against the caller's resolved allowlist.
//
// `Body` alone scopes to Claude Code harness telemetry: ServiceName carries the
// template name (OTEL_SERVICE_NAME, _helpers.tpl), so filtering it would hide
// every template not literally named `claude-code` (e.g. `bugstone`).
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
  // Child harness runs (a `claude -p` subshell, a dam-run executor) mint their
  // own session.id but inherit the session's W3C trace context (TRACEPARENT),
  // so their records carry the parent trace's TraceId. "This session" folds in
  // every session sharing a trace with the target — whole sessions, not just
  // same-trace rows, since a child's warmup calls carry no TraceId. Both
  // subqueries reuse the ownership + time predicate, so the fold never reaches
  // across owners; when the harness emitted no TraceId this degrades to the
  // exact-session match.
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

// ClickHouse returns Int64/UInt64 as JSON strings to avoid precision loss;
// coerce every numeric column back to a JS number at the boundary.
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
           sum(${COST_USD}) AS costUsd
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
      })) satisfies TokenSpendByModel[];
    },

    async spendByAgent(agentIds, window) {
      // Group on the trusted, gateway-stamped agent id — now the root Driver's
      // id for Invocation targets, so delegated work is attributed to the
      // Driver. The display name is read from the telemetry itself — argMaxIf
      // picks the latest `platform.agent.name` among the agent's OWN rows,
      // excluding child rows (those carrying a `platform.invocation.id`) whose
      // name belongs to the target, not the Driver the row is attributed to.
      // This keeps a heavy delegator's bar labelled with its own name instead
      // of the newest target's `invocation-<hex>`. A since-deleted agent still
      // shows its last known name. The name is display-only; the id is the key.
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
      // Bucket each call into a wall-clock day in the caller's timezone:
      // toTimeZone shifts the UTC Timestamp into `tz`, toDate truncates to that
      // local calendar day. The [from, to) instants already bound the window;
      // grouping by local day may pull in a call whose UTC day differs, which
      // is exactly what "the user's calendar" means. Output is sparse — only
      // days that actually had calls — and the client zero-fills the month.
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

    async runtimeBySession(agentIds, window) {
      // Group each session under the root of its trace family (root = the
      // earliest session on a shared trace), so child harness runs count
      // inside the session that spawned them. The CTEs stay session-unfiltered
      // but owner-gated; a session with no traced rows keeps its own id.
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
