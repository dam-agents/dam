import { z } from "zod";

// A telemetry read is always scoped to the caller's own agents (enforced
// server-side). `agentId` narrows to one of them; omitted means all of them.
// `sinceHours` bounds the lookback window — capped at 30 days so an unbounded
// scan can't be requested. `limit` bounds the unaggregated per-call rows.
export const telemetryOverviewInputSchema = z.object({
  agentId: z.string().min(1).optional(),
  sinceHours: z.coerce.number().int().positive().max(720).default(24),
  limit: z.coerce.number().int().positive().max(1000).default(100),
});
