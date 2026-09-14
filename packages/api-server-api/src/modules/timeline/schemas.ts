import { z } from "zod";
import {
  TIMELINE_DEFAULT_LOGS,
  TIMELINE_DEFAULT_LOG_ROWS,
  TIMELINE_DEFAULT_SINCE_HOURS,
  TIMELINE_DEFAULT_SPANS,
  TIMELINE_DEFAULT_TRACES,
  TIMELINE_MAX_LOGS,
  TIMELINE_MAX_LOG_ROWS,
  TIMELINE_MAX_SINCE_HOURS,
  TIMELINE_MAX_SPANS,
  TIMELINE_MAX_TRACES,
} from "./constants.js";

const traceId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9a-fA-F]+$/, { message: "traceId must be hexadecimal" });

const sinceHours = z.coerce
  .number()
  .int()
  .positive()
  .max(TIMELINE_MAX_SINCE_HOURS)
  .default(TIMELINE_DEFAULT_SINCE_HOURS);

export const timelineTracesInputSchema = z.object({
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  sinceHours,
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(TIMELINE_MAX_TRACES)
    .default(TIMELINE_DEFAULT_TRACES),
});

export const timelineTraceInputSchema = z.object({
  traceId,
  agentId: z.string().min(1).optional(),
  startedAt: z.string().datetime().optional(),
  sinceHours,
  spanLimit: z.coerce
    .number()
    .int()
    .positive()
    .max(TIMELINE_MAX_SPANS)
    .default(TIMELINE_DEFAULT_SPANS),
  logLimit: z.coerce
    .number()
    .int()
    .positive()
    .max(TIMELINE_MAX_LOGS)
    .default(TIMELINE_DEFAULT_LOGS),
});

export const timelineLogsInputSchema = z.object({
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  traceId: traceId.optional(),
  event: z.string().min(1).max(200).optional(),
  contains: z.string().min(1).max(200).optional(),
  sinceHours,
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(TIMELINE_MAX_LOG_ROWS)
    .default(TIMELINE_DEFAULT_LOG_ROWS),
});

export const timelineExportSignalSchema = z.enum(["spans", "logs"]);

export const timelineExportQuerySchema = z.object({
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  signal: timelineExportSignalSchema.default("logs"),
  sinceHours,
});
