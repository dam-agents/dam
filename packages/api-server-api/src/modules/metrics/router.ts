import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  metricsOverviewInputSchema,
  metricsSessionCostsInputSchema,
  metricsSpendBreakdownInputSchema,
} from "./schemas.js";

export const metricsRouter = t.router({
  overview: readAgentProcedure
    .input(metricsOverviewInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.metrics.overview(input);
    }),
  sessionCosts: readAgentProcedure
    .input(metricsSessionCostsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.metrics.sessionCosts(input);
    }),
  spendBreakdown: readAgentProcedure
    .input(metricsSpendBreakdownInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.metrics.spendBreakdown(input);
    }),
});
