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
  profileUpdateResultSchema,
  profileUsageSchema,
  profileViewSchema,
} from "./schemas.js";

export const profilesRouter = t.router({
  list: readAgentProcedure
    .input(profileListInputSchema)
    /* UNIT_BOUNDARY_DESCRIPTION: the profiles one agent can reference are its
     * owner's, so a call that names an agent runs in the owner's context and an
     * Agent Editor reads the owner's profiles, never their own. */
    .use(agentPermission("view", (input) => agentTarget(input?.agentId)))
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
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .output(profileUsageSchema)
    .query(({ ctx, input }) => ctx.profiles.usage(input.id)),

  /* UNIT_BOUNDARY_DESCRIPTION: through a shared agent an Agent Editor may read
   * the owner's profiles and reference them on that agent, and nothing else, so
   * a write that names an agent is refused when it would run for someone other
   * than the agent's owner. */
  create: manageAgentsProcedure
    .input(profileCreateInputSchema)
    .output(profileViewSchema)
    .mutation(async ({ ctx, input }) => {
      await refuseEditorWrite(ctx, input.agentId);
      return ctx.profiles.create(input);
    }),

  update: manageAgentsProcedure
    .input(profileUpdateInputSchema)
    .output(profileUpdateResultSchema)
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
