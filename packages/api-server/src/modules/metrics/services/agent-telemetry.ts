import type {
  agentMetricsInputSchema,
  CallContext,
  SessionRuntime,
  SubAgentSpend,
  TokenSpendByModel,
} from "api-server-api";
import type { z } from "zod";
import type {
  MetricsReader,
  MetricsWindow,
  TelemetryEvent,
  TraceSpan,
} from "./metrics-service.js";

export type AgentMetricsGranularity = z.output<
  typeof agentMetricsInputSchema
>["granularity"];

export interface AgentTelemetryQuery {
  days: number;
  limit: number;
  sessionId?: string;
}

export interface AgentMetricsQuery extends AgentTelemetryQuery {
  granularity: AgentMetricsGranularity;
}

interface Measured {
  available: true;
  windowDays: number;
  sessionId?: string;
}

export interface Unavailable {
  available: false;
  reason: string;
}

export type AgentMetricsResult =
  | (Measured & {
      granularity: AgentMetricsGranularity;
      totalCostUsd: number;
      totalDurationMs: number;
      sessionCount: number;
      byModel: TokenSpendByModel[];
      totalsCover: string;
      sessions?: SessionRuntime[];
      calls?: CallContext[];
      subAgents?: SubAgentSpend[];
      truncated?: boolean;
    })
  | Unavailable;

export type AgentLogsResult =
  (Measured & { logs: TelemetryEvent[]; truncated: boolean }) | Unavailable;

export type AgentSpansResult =
  | (Measured & { spans: TraceSpan[]; truncated: boolean })
  | (Measured & { spans: never[]; sessionUnresolved: true; reason: string })
  | Unavailable;

export interface AgentTelemetryService {
  metrics(
    agentId: string,
    query: AgentMetricsQuery,
  ): Promise<AgentMetricsResult>;
  logs(agentId: string, query: AgentTelemetryQuery): Promise<AgentLogsResult>;
  spans(agentId: string, query: AgentTelemetryQuery): Promise<AgentSpansResult>;
}

const SESSION_SCOPE =
  "this session together with any harness run it spawned, across the window";

const WINDOW_SCOPE = "every session in the window";

const SUB_AGENT_ROWS =
  "Each sub-agent row is that sub-agent's own spend, not its children's: a sub-agent that spawned its own has them as rows of their own. Your own calls have no row, so the totals are your spend plus every sub-agent's.";

const SUB_AGENT_SESSION =
  "A sub-agent runs in its own session, so the session narrowing reaches it only when its calls share that session's trace; omit sessionId to see every sub-agent in the window.";

function totalsCoverFor(query: AgentMetricsQuery): string {
  const scope = query.sessionId === undefined ? WINDOW_SCOPE : SESSION_SCOPE;
  const head = `Totals and sessionCount cover ${scope}.`;
  if (query.granularity === "summary")
    return `${head} This granularity returns no rows.`;
  const rows = `${head} They are counted separately from the rows below, which are only the most recent up to limit — truncated says whether more exist, so do not expect the rows to sum to the totals.`;
  if (query.granularity !== "subagent") return rows;
  return [
    rows,
    SUB_AGENT_ROWS,
    ...(query.sessionId === undefined ? [] : [SUB_AGENT_SESSION]),
  ].join(" ");
}

const UNRESOLVED_SESSION =
  "This session has no LLM-call records in the window, so the trace family that identifies its spans cannot be resolved. No narrowing was applied and no spans are reported — this is not a measurement of zero spans. Retry without sessionId to see the agent's spans across the window.";

function windowFor(query: AgentTelemetryQuery): MetricsWindow {
  return {
    hours: query.days * 24,
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
  };
}

function page<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

function measured(query: AgentTelemetryQuery): Measured {
  return {
    available: true,
    windowDays: query.days,
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
  };
}

export function createAgentTelemetry(deps: {
  reader: MetricsReader;
}): AgentTelemetryService {
  return {
    async metrics(agentId, query) {
      const window = windowFor(query);
      const [byModel, allSessions] = await Promise.all([
        deps.reader.tokenSpendByModel([agentId], window),
        deps.reader.runtimeBySession([agentId], window),
      ]);
      const base = {
        ...measured(query),
        granularity: query.granularity,
        totalCostUsd: byModel.reduce((sum, row) => sum + row.costUsd, 0),
        totalDurationMs: byModel.reduce((sum, row) => sum + row.durationMs, 0),
        sessionCount: allSessions.length,
        byModel,
        totalsCover: totalsCoverFor(query),
      };
      if (query.granularity === "session") {
        const { rows, truncated } = page(allSessions, query.limit);
        return { ...base, sessions: rows, truncated };
      }
      if (query.granularity === "call") {
        const { rows, truncated } = page(
          await deps.reader.contextPerCall([agentId], window, query.limit + 1),
          query.limit,
        );
        return { ...base, calls: rows, truncated };
      }
      if (query.granularity === "subagent") {
        const { rows, truncated } = page(
          await deps.reader.spendBySubAgent([agentId], window, query.limit + 1),
          query.limit,
        );
        return { ...base, subAgents: rows, truncated };
      }
      return base;
    },

    async logs(agentId, query) {
      const { rows, truncated } = page(
        await deps.reader.telemetryEvents(
          [agentId],
          windowFor(query),
          query.limit + 1,
        ),
        query.limit,
      );
      return { ...measured(query), logs: rows, truncated };
    },

    async spans(agentId, query) {
      const window = windowFor(query);
      if (
        query.sessionId !== undefined &&
        !(await deps.reader.sessionResolves([agentId], window))
      ) {
        return {
          ...measured(query),
          spans: [],
          sessionUnresolved: true,
          reason: UNRESOLVED_SESSION,
        };
      }
      const { rows, truncated } = page(
        await deps.reader.traceSpans([agentId], window, query.limit + 1),
        query.limit,
      );
      return { ...measured(query), spans: rows, truncated };
    },
  };
}

const NO_BACKEND =
  "The telemetry backend is not enabled on this deployment, so nothing about this agent's runs is measured here.";

export function createUnavailableAgentTelemetry(): AgentTelemetryService {
  const unavailable = async (): Promise<Unavailable> => ({
    available: false,
    reason: NO_BACKEND,
  });
  return {
    metrics: unavailable,
    logs: unavailable,
    spans: unavailable,
  };
}
