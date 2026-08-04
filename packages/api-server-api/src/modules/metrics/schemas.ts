import { z } from "zod";

// A metrics read is always scoped to the caller's own agents (enforced
// server-side). `agentId` narrows to one of them; omitted means all of them.
// `sinceHours` and `sessionId` are independent, composable filters: a lookback
// window (capped at 30 days) and an exact session. Omitted means unfiltered —
// no time bound and all sessions. `limit` bounds the unaggregated per-call
// rows.
export const metricsOverviewInputSchema = z.object({
  agentId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  sinceHours: z.coerce.number().int().positive().max(720).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
});

// The absolute half-open range [from, to) every spend read shares. Instants
// (not calendar fields) so the client decides what a "month" means in its own
// timezone. `spendBreakdown` extends this.
export const metricsSpendInputSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// A well-formed IANA zone name the runtime recognises. The client sends its own
// (`Intl.DateTimeFormat().resolvedOptions().timeZone`); we validate before it
// reaches the store so a garbage value fails as bad input rather than a query
// error.
const isValidTimeZone = (tz: string): boolean => {
  try {
    // Throws RangeError for an unknown zone; called for that check alone.
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// The whole Usage tab in one read: per-model, per-agent, and per-day spend over
// the same absolute [from, to) range. It carries the `spend` range plus the
// client's IANA timezone, needed only for the per-day bucketing — a "day" is a
// wall-clock calendar boundary the server otherwise never reasons about. One
// procedure so ownership resolves once and the client gets one loading state.
// `agentId` narrows to one owned agent, backing the sandbox-scoped Usage
// section; omitted means every agent the caller owns.
export const metricsSpendBreakdownInputSchema = metricsSpendInputSchema.extend({
  agentId: z.string().min(1).optional(),
  timeZone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, { message: "invalid IANA timeZone" }),
});
