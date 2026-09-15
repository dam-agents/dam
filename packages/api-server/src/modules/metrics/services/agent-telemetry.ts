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

export interface AgentTelemetryQuery {
  days: number;
  sessionId?: string;
}

export interface AgentTelemetryRecordsQuery extends AgentTelemetryQuery {
  limit: number;
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

export type AgentUsageSummaryResult =
  | (Measured & {
      totalCostUsd: number;
      totalDurationMs: number;
      sessionCount: number;
      byModel: TokenSpendByModel[];
      bySession: SessionRuntime[];
    })
  | Unavailable;

export type AgentLlmCallsResult =
  | (Measured & { calls: CallContext[] })
  | Unavailable;

export type AgentTelemetryEventsResult =
  | (Measured & { events: TelemetryEvent[] })
  | Unavailable;

export type AgentTraceSpansResult =
  | (Measured & { spans: TraceSpan[] })
  | Unavailable;

export interface AgentTelemetryService {
  summary(
    agentId: string,
    query: AgentTelemetryQuery,
  ): Promise<AgentUsageSummaryResult>;
  llmCalls(
    agentId: string,
    query: AgentTelemetryRecordsQuery,
  ): Promise<AgentLlmCallsResult>;
  telemetryEvents(
    agentId: string,
    query: AgentTelemetryRecordsQuery,
  ): Promise<AgentTelemetryEventsResult>;
  traceSpans(
    agentId: string,
    query: AgentTelemetryRecordsQuery,
  ): Promise<AgentTraceSpansResult>;
}

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
    async summary(agentId, query) {
      const window = windowFor(query);
      const [byModel, bySession] = await Promise.all([
        deps.reader.tokenSpendByModel([agentId], window),
        deps.reader.runtimeBySession([agentId], window),
      ]);
      return {
        ...measured(query),
        totalCostUsd: byModel.reduce((sum, row) => sum + row.costUsd, 0),
        totalDurationMs: byModel.reduce((sum, row) => sum + row.durationMs, 0),
        sessionCount: bySession.length,
        byModel,
        bySession,
      };
    },

    async llmCalls(agentId, query) {
      return {
        ...measured(query),
        calls: await deps.reader.contextPerCall(
          [agentId],
          windowFor(query),
          query.limit,
        ),
      };
    },

    async telemetryEvents(agentId, query) {
      return {
        ...measured(query),
        events: await deps.reader.telemetryEvents(
          [agentId],
          windowFor(query),
          query.limit,
        ),
      };
    },

    async traceSpans(agentId, query) {
      return {
        ...measured(query),
        spans: await deps.reader.traceSpans(
          [agentId],
          windowFor(query),
          query.limit,
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
    summary: unavailable,
    llmCalls: unavailable,
    telemetryEvents: unavailable,
    traceSpans: unavailable,
  };
}
