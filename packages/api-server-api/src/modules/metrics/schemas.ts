import { z } from "zod";
import {
  AGENT_TELEMETRY_DEFAULT_DAYS,
  AGENT_TELEMETRY_DEFAULT_LIMIT,
  AGENT_TELEMETRY_MAX_DAYS,
  AGENT_TELEMETRY_MAX_LIMIT,
  METRICS_DEFAULT_LIMIT,
  METRICS_MAX_LIMIT,
  METRICS_MAX_SINCE_HOURS,
} from "./constants.js";

export const metricsOverviewInputSchema = z.object({
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  sinceHours: z.coerce
    .number()
    .int()
    .positive()
    .max(METRICS_MAX_SINCE_HOURS)
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(METRICS_MAX_LIMIT)
    .default(METRICS_DEFAULT_LIMIT),
});

const agentTelemetryWindowShape = {
  days: z
    .number()
    .int()
    .min(1)
    .max(AGENT_TELEMETRY_MAX_DAYS)
    .default(AGENT_TELEMETRY_DEFAULT_DAYS)
    .describe(
      `Window length in days, counted back from now (default ${AGENT_TELEMETRY_DEFAULT_DAYS}, max ${AGENT_TELEMETRY_MAX_DAYS}).`,
    ),
  sessionId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Narrow to a single session, including any harness run that session spawned. Omit to cover every session in the window.",
    ),
};

export const usageSummaryInputSchema = z.object(agentTelemetryWindowShape);

export const agentTelemetryRecordsInputSchema = z.object({
  ...agentTelemetryWindowShape,
  limit: z
    .number()
    .int()
    .positive()
    .max(AGENT_TELEMETRY_MAX_LIMIT)
    .default(AGENT_TELEMETRY_DEFAULT_LIMIT)
    .describe(
      `Most recent records to return, newest first (default ${AGENT_TELEMETRY_DEFAULT_LIMIT}, max ${AGENT_TELEMETRY_MAX_LIMIT}).`,
    ),
});

export const metricsSpendInputSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

const isValidTimeZone = (tz: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const metricsSpendBreakdownInputSchema = metricsSpendInputSchema.extend({
  agentId: z.string().min(1).optional(),
  timeZone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, { message: "invalid IANA timeZone" }),
});
