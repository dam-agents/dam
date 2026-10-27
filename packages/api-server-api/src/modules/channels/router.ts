import { z } from "zod";
import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
  manageAgentsProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import {
  sessionChoiceReferencesSchema,
  sessionPairSchema,
} from "../harness-config/schemas.js";

/* UNIT_BOUNDARY_DESCRIPTION: what a channel's turns run on, picked in the chat
 * default's shape; neither a pair nor a profile is a binding that follows the
 * agent's default, as one bound before profiles does. */
export const channelChoiceInputSchema = z
  .object({
    agentId: z.string().min(1),
    type: z.enum(["slack", "telegram"]),
    slackChannelId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
    pair: sessionPairSchema.nullable(),
  })
  .merge(sessionChoiceReferencesSchema);

export const channelsRouter = t.router({
  available: readAgentProcedure.query(({ ctx }) => ctx.channels.available),

  setChoice: manageAgentsProcedure
    .input(channelChoiceInputSchema)
    .use(agentPermission("settings", (input) => agentTarget(input.agentId)))
    .mutation(({ ctx, input }) => ctx.channels.setChoice(input)),

  telegramBot: readAgentProcedure.query(({ ctx }) => {
    const username = ctx.channels.telegramBotUsername();
    return username ? { username } : null;
  }),

  slackChannelChoices: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.channels.slackChannelChoices()),
});
