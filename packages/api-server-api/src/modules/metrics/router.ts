import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  metricsOverviewInputSchema,
  metricsSpendBreakdownInputSchema,
} from "./schemas.js";

// Ownership is enforced in the service (it resolves the caller's owned agent
// IDs and filters on them). Whenever a procedure is narrowed to a specific
// agentId we also apply the API-key binding check, matching the rest of the
// agent-read surface.
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
