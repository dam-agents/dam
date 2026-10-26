import { z } from "zod";
import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
  manageAgentsProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";

export const channelsRouter = t.router({
  available: readAgentProcedure.query(({ ctx }) => ctx.channels.available),

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
    .mutation(({ ctx, input }) => ctx.channels.setProfile(input)),

  telegramBot: readAgentProcedure.query(({ ctx }) => {
    const username = ctx.channels.telegramBotUsername();
    return username ? { username } : null;
  }),

  slackChannelChoices: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.channels.slackChannelChoices()),
});
