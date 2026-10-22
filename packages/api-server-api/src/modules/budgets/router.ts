import { t } from "../../trpc.js";
import {
  operatorProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  userBudgetRemoveInputSchema,
  userBudgetSetInputSchema,
  userBudgetsListInputSchema,
} from "./schemas.js";

export const budgetsRouter = t.router({
  reserved: readAgentProcedure.query(({ ctx }) => ctx.budgets.reserved()),

  users: t.router({
    list: operatorProcedure
      .input(userBudgetsListInputSchema)
      .query(({ ctx, input }) => ctx.userBudgets.list(input)),

    set: operatorProcedure
      .input(userBudgetSetInputSchema)
      .mutation(({ ctx, input }) => ctx.userBudgets.set(input)),

    remove: operatorProcedure
      .input(userBudgetRemoveInputSchema)
      .mutation(({ ctx, input }) => ctx.userBudgets.remove(input)),
  }),
});
