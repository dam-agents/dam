import type { z } from "zod";
import type {
  telemetryExportQuerySchema,
  telemetryExportSignalSchema,
  telemetryLogsInputSchema,
  telemetryTurnInputSchema,
  telemetryTurnsInputSchema,
} from "./schemas.js";

export type TelemetryTurnsQuery = z.infer<typeof telemetryTurnsInputSchema>;
export type TelemetryTurnQuery = z.infer<typeof telemetryTurnInputSchema>;
export type TelemetryLogsQuery = z.infer<typeof telemetryLogsInputSchema>;
export type TelemetryExportQuery = z.infer<typeof telemetryExportQuerySchema>;
export type TelemetryExportSignal = z.infer<typeof telemetryExportSignalSchema>;

export interface TurnSummary {
  turnId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  prompted: boolean;
  rootName: string;
  spanCount: number;
  recordCount: number;
  errorCount: number;
  traceIds: string[];
  models: string[];
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export type LogAttachment = "request-id" | "span-id" | "trace-root";

export interface TelemetrySpan {
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: string;
  service: string;
  startedAt: string;
  durationMs: number;
  statusCode: string;
  statusMessage: string;
  agentId: string;
  invocationId: string | null;
  attributes: Record<string, string>;
}

export interface TelemetryLog {
  at: string;
  spanId: string;
  traceId: string;
  event: string;
  severity: string;
  service: string;
  agentId: string;
  invocationId: string | null;
  attributes: Record<string, string>;
  attachedTo: string | null;
  attachedBy: LogAttachment;
}

export interface TurnDetail {
  turnId: string;
  startedAt: string;
  durationMs: number;
  spans: TelemetrySpan[];
  logs: TelemetryLog[];
  spansTruncated: boolean;
  logsTruncated: boolean;
}

export interface TelemetryUnavailable {
  available: false;
  reason: string;
}

export interface TelemetryTurns {
  available: true;
  turns: TurnSummary[];
  truncated: boolean;
}

export interface TelemetryTurn {
  available: true;
  turn: TurnDetail;
}

export interface TelemetryLogs {
  available: true;
  records: TelemetryLog[];
  truncated: boolean;
}

export type TelemetryTurnsResult = TelemetryTurns | TelemetryUnavailable;
export type TelemetryTurnResult = TelemetryTurn | TelemetryUnavailable;
export type TelemetryLogsResult = TelemetryLogs | TelemetryUnavailable;

export interface TelemetryService {
  turns(query: TelemetryTurnsQuery): Promise<TelemetryTurnsResult>;
  turn(query: TelemetryTurnQuery): Promise<TelemetryTurnResult>;
  logs(query: TelemetryLogsQuery): Promise<TelemetryLogsResult>;
}
