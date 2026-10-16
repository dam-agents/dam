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
    .describe(`Window length in days, counted back from now.`),
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
      `Most rows to return, newest first. Bounds the row list only; a result's own totalsCover states what its totals span.`,
    ),
};

export const agentTelemetryInputSchema = z.object(agentTelemetryShape);

export const agentMetricsInputSchema = z.object({
  ...agentTelemetryShape,
  days: agentTelemetryShape.days.describe(
    "Window length in whole UTC days: today and the days before it.",
  ),
  granularity: z
    .enum(["summary", "session", "call", "subagent"])
    .default("summary")
    .describe(
      "Detail level. 'summary': window totals per unit and the per-model split. 'session': adds a row per session — its spend with the part of the sub-agents spawned from it, calls, model time, tokens, first/last day. 'call': adds a row per LLM call from your own telemetry — model, request latency, tokens, context size, no cost. 'subagent': adds a row per platform sub-agent you spawned, directly or through another sub-agent, keyed by the id spawn_subagent returned — its own spend, models, calls, model time, tokens, first/last day.",
    ),
});

const metricsSpendInputSchema = z.object({
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
