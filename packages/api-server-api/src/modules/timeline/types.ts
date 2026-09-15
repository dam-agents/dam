import type { z } from "zod";
import type {
  timelineExportQuerySchema,
  timelineExportSignalSchema,
  timelineLogsInputSchema,
  timelineTurnInputSchema,
  timelineTurnsInputSchema,
} from "./schemas.js";

export type TimelineTurnsQuery = z.infer<typeof timelineTurnsInputSchema>;
export type TimelineTurnQuery = z.infer<typeof timelineTurnInputSchema>;
export type TimelineLogsQuery = z.infer<typeof timelineLogsInputSchema>;
export type TimelineExportQuery = z.infer<typeof timelineExportQuerySchema>;
export type TimelineExportSignal = z.infer<typeof timelineExportSignalSchema>;

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

export interface TimelineSpan {
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

export interface TimelineLog {
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
  spans: TimelineSpan[];
  logs: TimelineLog[];
  spansTruncated: boolean;
  logsTruncated: boolean;
}

export interface TimelineUnavailable {
  available: false;
  reason: string;
}

export interface TimelineTurns {
  available: true;
  turns: TurnSummary[];
  truncated: boolean;
}

export interface TimelineTurn {
  available: true;
  turn: TurnDetail;
}

export interface TimelineLogs {
  available: true;
  records: TimelineLog[];
  truncated: boolean;
}

export type TimelineTurnsResult = TimelineTurns | TimelineUnavailable;
export type TimelineTurnResult = TimelineTurn | TimelineUnavailable;
export type TimelineLogsResult = TimelineLogs | TimelineUnavailable;

export interface TimelineService {
  turns(query: TimelineTurnsQuery): Promise<TimelineTurnsResult>;
  turn(query: TimelineTurnQuery): Promise<TimelineTurnResult>;
  logs(query: TimelineLogsQuery): Promise<TimelineLogsResult>;
}
