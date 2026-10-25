import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";

export const channelsRouter = t.router({
  available: readAgentProcedure.query(({ ctx }) => ctx.channels.available),

  /* UNIT_BOUNDARY_DESCRIPTION: the profile a channel's turns run on (D91), set
   * from the channel's row; an Agent Editor may change it, as any set-up. */
  setProfile: manageAgentsProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        type: z.enum(["slack", "telegram"]),
        slackChannelId: z.string().min(1).optional(),
        conversationId: z.string().min(1).optional(),
        profileId: z.string().min(1).nullable(),
      }),
    )
    .use(agentPermission("settings", (input) => agentTarget(input.agentId)))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.channels.setProfile(input);
      /* UNIT_BOUNDARY_DESCRIPTION: a write that matched no binding, or a profile
       * the agent's owner does not hold, is a refusal rather than a success the
       * UI would show as done. */
      if (result === "not-owned")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That profile is not one this agent's owner holds",
        });
      if (result === "no-such-channel")
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This agent has no such channel bound",
        });
      return true;
    }),

  telegramBot: readAgentProcedure.query(({ ctx }) => {
    const username = ctx.channels.telegramBotUsername();
    return username ? { username } : null;
  }),
});
