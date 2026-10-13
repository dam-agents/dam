import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  spendDailyInputSchema,
  spendSetLimitInputSchema,
  spendStatusInputSchema,
} from "./schemas.js";

export const spendRouter = t.router({
  daily: readAgentProcedure
    .input(spendDailyInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.daily(input);
    }),

  status: readAgentProcedure
    .input(spendStatusInputSchema)
    .query(({ ctx, input }) => {
      if (input?.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.status(input);
    }),

  setLimit: manageAgentsProcedure
    .input(spendSetLimitInputSchema)
    .mutation(({ ctx, input }) => ctx.spend.setLimit(input)),
});
