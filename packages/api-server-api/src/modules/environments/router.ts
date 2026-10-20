import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  environmentExtendInputSchema,
  environmentIdInputSchema,
  environmentListInputSchema,
} from "./schemas.js";

export const environmentsRouter = t.router({
  list: readAgentProcedure
    .input(environmentListInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.owningAgentId);
      return ctx.environments.list(input.owningAgentId);
    }),

  extend: manageAgentsProcedure
    .input(environmentExtendInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.environments.extend(input.id, new Date(input.expiresAt)),
    ),

  delete: manageAgentsProcedure
    .input(environmentIdInputSchema)
    .mutation(({ ctx, input }) => ctx.environments.delete(input.id)),
});
