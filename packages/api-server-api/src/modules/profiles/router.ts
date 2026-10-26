import { t } from "../../trpc.js";
import { TRPCError } from "@trpc/server";
import {
  agentPermission,
  agentTarget,
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import type { ApiContext } from "../../context.js";
import {
  profileCreateInputSchema,
  profileIdInputSchema,
  profileListInputSchema,
  profileUpdateInputSchema,
  profileUsageSchema,
  profileViewSchema,
} from "./schemas.js";

export const profilesRouter = t.router({
  list: readAgentProcedure
    .input(profileListInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input?.agentId)))
    .output(profileViewSchema.array())
    .query(({ ctx, input }) => {
      if (input?.agentId !== undefined) checkAgentBinding(ctx, input.agentId);
      return ctx.profiles.list(input);
    }),

  usage: readAgentProcedure
    .input(profileIdInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .output(profileUsageSchema)
    .query(({ ctx, input }) => {
      if (input.agentId !== undefined) checkAgentBinding(ctx, input.agentId);
      return ctx.profiles.usage(input.id);
    }),

  create: manageAgentsProcedure
    .input(profileCreateInputSchema)
    .output(profileViewSchema)
    .mutation(async ({ ctx, input }) => {
      await refuseEditorWrite(ctx, input.agentId);
      return ctx.profiles.create(input);
    }),

  update: manageAgentsProcedure
    .input(profileUpdateInputSchema)
    .output(profileViewSchema)
    .mutation(async ({ ctx, input }) => {
      await refuseEditorWrite(ctx, input.agentId);
      return ctx.profiles.update(input);
    }),

  delete: manageAgentsProcedure
    .input(profileIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      await refuseEditorWrite(ctx, input.agentId);
      return ctx.profiles.delete(input.id);
    }),
});

/** UNIT_BOUNDARY_DESCRIPTION: a write made from an agent runs in the agent's owner's context only for the owner. Anyone else is an Agent Editor, and an editor may reference a profile on the agent but never change the owner's set — its other agents point at it too. */
async function refuseEditorWrite(
  ctx: ApiContext,
  agentId: string | undefined,
): Promise<void> {
  if (agentId === undefined) return;
  const acting = await ctx.actOnAgent(agentTarget(agentId)!, "settings", {
    path: "profiles",
    mutation: true,
  });
  if (!acting.ok || acting.ctx !== ctx)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only the agent's owner can save or change a profile; you can use this agent's owner's profiles as they are.",
    });
}
