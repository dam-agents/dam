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

/* UNIT_BOUNDARY_DESCRIPTION: the agent a Bridge call acts for. The owner is
 * never in the input — a procedure runs as the caller, and the service refuses
 * an Agent that caller does not own. */
export const slackDmAgentInputSchema = z.object({
  agentId: z.string().min(1),
  purpose: z.string().max(280).optional(),
});

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

  slackDmStatus: readAgentProcedure.query(({ ctx }) =>
    ctx.channels.slackDm.status(),
  ),

  slackDmConnect: manageAgentsProcedure
    .input(slackDmAgentInputSchema)
    .use(agentPermission("channels", (input) => agentTarget(input.agentId)))
    .mutation(({ ctx, input }) =>
      ctx.channels.slackDm.connect({
        agentId: input.agentId,
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
      }),
    ),

  slackDmDisconnect: manageAgentsProcedure
    .input(slackDmAgentInputSchema)
    .use(agentPermission("channels", (input) => agentTarget(input.agentId)))
    .mutation(({ ctx, input }) =>
      ctx.channels.slackDm.disconnect({ agentId: input.agentId }),
    ),
});
