import { t } from "../../trpc.js";
import {
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  profileCreateInputSchema,
  profileIdInputSchema,
  profileUpdateInputSchema,
  profileUsageSchema,
  profileViewSchema,
} from "./schemas.js";

export const profilesRouter = t.router({
  list: readAgentProcedure
    .output(profileViewSchema.array())
    .query(({ ctx }) => ctx.profiles.list()),

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
    .output(profileViewSchema)
    .mutation(({ ctx, input }) => ctx.profiles.update(input)),

  delete: manageAgentsProcedure
    .input(profileIdInputSchema)
    .mutation(({ ctx, input }) => ctx.profiles.delete(input.id)),
});
