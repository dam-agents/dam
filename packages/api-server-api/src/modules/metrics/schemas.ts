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

// Per-model spend over an absolute half-open range [from, to), across all of
// the caller's agents. Instants (not calendar fields) so the client decides
// what a "month" means in its own timezone.
export const metricsSpendInputSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// Spend bucketed into local calendar days over [from, to). Same instant range
// as `spend`, plus the IANA timezone the day boundaries are cut on — supplied
// by the client (`Intl.DateTimeFormat().resolvedOptions().timeZone`) so buckets
// line up with the user's wall-clock days. The grouping happens in ClickHouse.
export const metricsSpendByDayInputSchema = metricsSpendInputSchema.extend({
  timeZone: z.string().min(1),
});
