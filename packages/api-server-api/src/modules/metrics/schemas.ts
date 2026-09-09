import { z } from "zod";
import {
  METRICS_DEFAULT_LIMIT,
  METRICS_MAX_LIMIT,
  METRICS_MAX_SINCE_HOURS,
  USAGE_SUMMARY_DEFAULT_DAYS,
  USAGE_SUMMARY_MAX_DAYS,
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

export const usageSummaryInputSchema = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(USAGE_SUMMARY_MAX_DAYS)
    .default(USAGE_SUMMARY_DEFAULT_DAYS)
    .describe(
      `Window length in days, counted back from now (default ${USAGE_SUMMARY_DEFAULT_DAYS}, max ${USAGE_SUMMARY_MAX_DAYS}).`,
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
