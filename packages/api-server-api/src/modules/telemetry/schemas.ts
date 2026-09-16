import { z } from "zod";
import {
  TELEMETRY_DEFAULT_LOGS,
  TELEMETRY_DEFAULT_LOG_ROWS,
  TELEMETRY_DEFAULT_SINCE_HOURS,
  TELEMETRY_DEFAULT_SPANS,
  TELEMETRY_DEFAULT_TURNS,
  TELEMETRY_MAX_LOGS,
  TELEMETRY_MAX_LOG_ROWS,
  TELEMETRY_MAX_SINCE_HOURS,
  TELEMETRY_MAX_SPANS,
  TELEMETRY_MAX_TURNS,
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
  .max(TELEMETRY_MAX_SINCE_HOURS)
  .default(TELEMETRY_DEFAULT_SINCE_HOURS);

export const telemetryTurnsInputSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  sinceHours,
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(TELEMETRY_MAX_TURNS)
    .default(TELEMETRY_DEFAULT_TURNS),
  spanLimit: z.coerce
    .number()
    .int()
    .positive()
    .max(TELEMETRY_MAX_SPANS)
    .default(TELEMETRY_DEFAULT_SPANS),
  logLimit: z.coerce
    .number()
    .int()
    .positive()
    .max(TELEMETRY_MAX_LOGS)
    .default(TELEMETRY_DEFAULT_LOGS),
});

export const telemetryTurnInputSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  from: z.string().datetime(),
  to: z.string().datetime(),
  spanLimit: z.coerce
    .number()
    .int()
    .positive()
    .max(TELEMETRY_MAX_SPANS)
    .default(TELEMETRY_DEFAULT_SPANS),
  logLimit: z.coerce
    .number()
    .int()
    .positive()
    .max(TELEMETRY_MAX_LOGS)
    .default(TELEMETRY_DEFAULT_LOGS),
});

export const telemetryLogsInputSchema = z.object({
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
    .max(TELEMETRY_MAX_LOG_ROWS)
    .default(TELEMETRY_DEFAULT_LOG_ROWS),
});

export const telemetryExportSignalSchema = z.enum(["spans", "logs"]);

export const telemetryExportQuerySchema = z.object({
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  signal: telemetryExportSignalSchema.default("logs"),
  sinceHours,
});
