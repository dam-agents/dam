import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  environmentAccessListInputSchema,
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

  accessList: readAgentProcedure
    .input(environmentListInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.owningAgentId);
      return ctx.environments.accessList(input.owningAgentId);
    }),

  setAccessList: manageAgentsProcedure
    .input(environmentAccessListInputSchema)
    .mutation(({ ctx, input }) => {
      checkAgentBinding(ctx, input.owningAgentId);
      return ctx.environments.setAccessList(input.owningAgentId, input.emails);
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
