import type {
  CallContext,
  SessionRuntime,
  TokenSpendByModel,
} from "api-server-api";
import type {
  MetricsReader,
  MetricsWindow,
  TelemetryEvent,
  TraceSpan,
} from "./metrics-service.js";

export type AgentMetricsGranularity = "summary" | "session" | "call";

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
      truncated?: boolean;
    })
  | Unavailable;

export type AgentLogsResult =
  | (Measured & { logs: TelemetryEvent[] })
  | Unavailable;

export type AgentSpansResult =
  | (Measured & { spans: TraceSpan[] })
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

const TOTALS_COVER =
  "Totals and sessionCount cover every session in the window; any row list beside them is capped at limit, newest first, and says so via truncated.";

const UNRESOLVED_SESSION =
  "This session has no LLM-call records in the window, so the trace family that identifies its spans cannot be resolved. No narrowing was applied and no spans are reported — this is not a measurement of zero spans. Retry without sessionId to see the agent's spans across the window.";

function windowFor(query: AgentTelemetryQuery): MetricsWindow {
  return {
    hours: query.days * 24,
    ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
  };
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
        totalsCover: TOTALS_COVER,
      };
      if (query.granularity === "session") {
        const sessions = allSessions.slice(0, query.limit);
        return {
          ...base,
          sessions,
          truncated: allSessions.length > sessions.length,
        };
      }
      if (query.granularity === "call") {
        const calls = await deps.reader.contextPerCall(
          [agentId],
          window,
          query.limit,
        );
        return { ...base, calls, truncated: calls.length === query.limit };
      }
      return base;
    },

    async logs(agentId, query) {
      return {
        ...measured(query),
        logs: await deps.reader.telemetryEvents(
          [agentId],
          windowFor(query),
          query.limit,
        ),
      };
    },

    async spans(agentId, query) {
      const window = windowFor(query);
      if (query.sessionId === undefined) {
        return {
          ...measured(query),
          spans: await deps.reader.traceSpans([agentId], window, query.limit),
        };
      }
      const traceIds = await deps.reader.sessionTraceIds([agentId], window);
      if (traceIds.length === 0) {
        return {
          ...measured(query),
          spans: [],
          sessionUnresolved: true,
          reason: UNRESOLVED_SESSION,
        };
      }
      return {
        ...measured(query),
        spans: await deps.reader.traceSpans(
          [agentId],
          window,
          query.limit,
          traceIds,
        ),
      };
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
