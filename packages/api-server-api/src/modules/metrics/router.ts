import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  metricsOverviewInputSchema,
  metricsSpendBreakdownInputSchema,
} from "./schemas.js";

// Authorization splits the same way as the rest of the agent surface: owner
// scoping belongs to the service (it resolves the caller's owned agent IDs and
// filters on them), API-key binding belongs to the router — `checkAgentBinding`
// on any input narrowed to one agentId. The service alone would already deny an
// unbound agent, since its owned-ID list is narrowed to the key's binding; the
// check turns that empty result into a FORBIDDEN.
export const metricsRouter = t.router({
  overview: readAgentProcedure
    .input(metricsOverviewInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.metrics.overview(input);
    }),
  // One read backs the whole Usage tab: per-model, per-agent, and per-day spend
  // over [from, to). Collapsed from three procedures so ownership resolves once
  // per page load (one agent-list + scope check, not three) and the client gets
  // a single loading/error state.
  spendBreakdown: readAgentProcedure
    .input(metricsSpendBreakdownInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.metrics.spendBreakdown(input);
    }),
});
