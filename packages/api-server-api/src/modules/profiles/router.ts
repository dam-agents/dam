import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  profileCreateInputSchema,
  profileIdInputSchema,
  profileListInputSchema,
  profileUpdateInputSchema,
  profileUpdateResultSchema,
  profileUsageSchema,
  profileViewSchema,
} from "./schemas.js";

export const profilesRouter = t.router({
  list: readAgentProcedure
    .input(profileListInputSchema)
    .output(profileViewSchema.array())
    .query(({ ctx, input }) => {
      /* UNIT_BOUNDARY_DESCRIPTION: a key bound to some agents may not read what
       * another agent of the owner holds, so a list that names one is checked
       * against the key's binding like every agent-scoped read. */
      if (input?.agentId !== undefined) checkAgentBinding(ctx, input.agentId);
      return ctx.profiles.list(input);
    }),

  usage: readAgentProcedure
    .input(profileIdInputSchema)
    .output(profileUsageSchema)
    .query(({ ctx, input }) => ctx.profiles.usage(input.id)),

  create: manageAgentsProcedure
    .input(profileCreateInputSchema)
    .output(profileViewSchema)
    .mutation(({ ctx, input }) => ctx.profiles.create(input)),

  update: manageAgentsProcedure
    .input(profileUpdateInputSchema)
    .output(profileUpdateResultSchema)
    .mutation(({ ctx, input }) => ctx.profiles.update(input)),

  delete: manageAgentsProcedure
    .input(profileIdInputSchema)
    .mutation(({ ctx, input }) => ctx.profiles.delete(input.id)),
});
