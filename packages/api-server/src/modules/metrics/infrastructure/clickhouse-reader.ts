import { type ClickHouseClient, createClient } from "@clickhouse/client";
import type {
  CallContext,
  SessionRuntime,
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
const ownedApiRequests = (w: MetricsWindow) =>
  [
    "ServiceName = 'claude-code'",
    "Body = 'claude_code.api_request'",
    "ResourceAttributes['platform.agent.id'] IN {agentIds:Array(String)}",
    ...(w.hours === undefined
      ? []
      : ["Timestamp >= now() - toIntervalHour({hours:UInt32})"]),
    ...(w.sessionId === undefined
      ? []
      : ["LogAttributes['session.id'] = {sessionId:String}"]),
  ].join("\n  AND ");

const windowParams = (agentIds: readonly string[], w: MetricsWindow) => ({
  agentIds,
  ...(w.hours === undefined ? {} : { hours: w.hours }),
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

    async runtimeBySession(agentIds, window) {
      const r = await rows(
        `SELECT
           LogAttributes['session.id'] AS sessionId,
           ResourceAttributes['platform.agent.id'] AS agentId,
           count() AS calls,
           sum(${IN("'duration_ms'")}) AS totalDurationMs,
           sum(${TOK_IN}) AS inputTokens,
           sum(${IN("'output_tokens'")}) AS outputTokens,
           sum(${TOK_CACHE_R}) AS cacheReadTokens,
           sum(${TOK_CACHE_C}) AS cacheCreationTokens,
           sum(${COST_USD}) AS costUsd,
           min(Timestamp) AS firstAt,
           max(Timestamp) AS lastAt
         FROM otel_logs
         WHERE ${ownedApiRequests(window)} AND LogAttributes['session.id'] != ''
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
