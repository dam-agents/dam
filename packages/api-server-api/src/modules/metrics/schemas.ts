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

const agentTelemetryShape = {
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
  limit: z
    .number()
    .int()
    .positive()
    .max(AGENT_TELEMETRY_MAX_LIMIT)
    .default(AGENT_TELEMETRY_DEFAULT_LIMIT)
    .describe(
      `Most rows to return, newest first (default ${AGENT_TELEMETRY_DEFAULT_LIMIT}, max ${AGENT_TELEMETRY_MAX_LIMIT}). Bounds the row list only; a result's own totalsCover states what its totals span.`,
    ),
};

export const agentTelemetryInputSchema = z.object(agentTelemetryShape);

export const agentMetricsInputSchema = z.object({
  ...agentTelemetryShape,
  granularity: z
    .enum(["summary", "session", "call"])
    .default("summary")
    .describe(
      "Detail level. 'summary': window totals and the per-model split. 'session': adds a row per session — calls, model time, tokens, cost, first/last activity. 'call': adds a row per LLM call — model, request latency, tokens, context size, cost.",
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
