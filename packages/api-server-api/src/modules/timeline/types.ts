import type { z } from "zod";
import type {
  timelineExportQuerySchema,
  timelineExportSignalSchema,
  timelineLogsInputSchema,
  timelineTraceInputSchema,
  timelineTracesInputSchema,
} from "./schemas.js";

export type TimelineTracesQuery = z.infer<typeof timelineTracesInputSchema>;
export type TimelineTraceQuery = z.infer<typeof timelineTraceInputSchema>;
export type TimelineLogsQuery = z.infer<typeof timelineLogsInputSchema>;
export type TimelineExportQuery = z.infer<typeof timelineExportQuerySchema>;
export type TimelineExportSignal = z.infer<typeof timelineExportSignalSchema>;

export interface TraceSummary {
  traceId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  rootName: string;
  spanCount: number;
  errorCount: number;
  services: string[];
  sessionIds: string[];
  recordCount: number;
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

export interface TraceDetail {
  traceId: string;
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

export interface TimelineTraces {
  available: true;
  traces: TraceSummary[];
  truncated: boolean;
}

export interface TimelineTrace {
  available: true;
  trace: TraceDetail;
}

export interface TimelineLogs {
  available: true;
  records: TimelineLog[];
  truncated: boolean;
}

export type TimelineTracesResult = TimelineTraces | TimelineUnavailable;
export type TimelineTraceResult = TimelineTrace | TimelineUnavailable;
export type TimelineLogsResult = TimelineLogs | TimelineUnavailable;

export interface TimelineService {
  traces(query: TimelineTracesQuery): Promise<TimelineTracesResult>;
  trace(query: TimelineTraceQuery): Promise<TimelineTraceResult>;
  logs(query: TimelineLogsQuery): Promise<TimelineLogsResult>;
}
