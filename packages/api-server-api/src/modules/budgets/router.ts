import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";

export const budgetsRouter = t.router({
  reserved: readAgentProcedure.query(({ ctx }) => ctx.budgets.reserved()),
});
