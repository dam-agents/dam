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
