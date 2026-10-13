import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { spendDailyInputSchema } from "./schemas.js";

export const spendRouter = t.router({
  daily: readAgentProcedure
    .input(spendDailyInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.daily(input);
    }),
});
