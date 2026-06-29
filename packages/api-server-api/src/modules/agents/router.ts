import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  agentConnectSlackInputSchema,
  agentConnectTelegramInputSchema,
  agentCreateInputSchema,
  agentDeleteInputSchema,
  agentDisconnectSlackInputSchema,
  agentDisconnectTelegramInputSchema,
  agentGetInputSchema,
  agentRestartInputSchema,
  agentUpdateInputSchema,
  agentWakeInputSchema,
} from "./schemas.js";
import type { Agent } from "./types.js";

function toView(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    templateId: agent.templateId ?? null,
    image: agent.spec.image,
    description: agent.spec.description,
    env: agent.spec.env,
    // Effective idle timeout (0 = never): the per-agent override resolved against the global default by the service.
    hibernationTimeoutMin: agent.effectiveHibernationTimeoutMin,
    grantedSecretIds: agent.spec.grantedSecretIds ?? [],
    grantedConnectionIds: agent.spec.grantedConnectionIds ?? [],
    state: agent.state,
    error: agent.error,
    podTerminationReason: agent.podTerminationReason,
    contributionFailures: agent.contributionFailures,
    channels: agent.channels,
    allowedUserEmails: agent.allowedUserEmails,
  };
}

export const agentsRouter = t.router({
  list: readAgentProcedure.query(async ({ ctx }) => {
    const agents = await ctx.agents.list();
    // For agent-bound keys, narrow the listing to the bound set so callers
    // don't see agents they couldn't operate on anyway.
    const allowed =
      ctx.user.agentIds === "*"
        ? agents
        : agents.filter((a) => ctx.user.agentIds.includes(a.id));
    return allowed.map(toView);
  }),

  get: readAgentProcedure
    .input(agentGetInputSchema)
    .query(async ({ ctx, input }) => {
      checkAgentBinding(ctx, input.id);
      const agent = await ctx.agents.get(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  create: manageAgentsProcedure
    .input(agentCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.create(input);
      return toView(agent);
    }),

  update: manageAgentsProcedure
    .input(agentUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.update(input);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  delete: manageAgentsProcedure
    .input(agentDeleteInputSchema)
    .mutation(({ ctx, input }) => ctx.agents.delete(input.id)),

  restart: manageAgentsProcedure
    .input(agentRestartInputSchema)
    .mutation(async ({ ctx, input }) => {
      const ok = await ctx.agents.restart(input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
    }),

  wake: manageAgentsProcedure
    .input(agentWakeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.wake(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  connectSlack: manageAgentsProcedure
    .input(agentConnectSlackInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.slack)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Slack app token not configured",
        });
      const res = await ctx.agents.connectSlack(input.id, input.slackChannelId);
      if (res.ok) return toView(res.value);
      switch (res.error.type) {
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "ChannelAlreadyBound":
          throw new TRPCError({
            code: "CONFLICT",
            message: "Slack channel already bound",
          });
      }
    }),

  disconnectSlack: manageAgentsProcedure
    .input(agentDisconnectSlackInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.disconnectSlack(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  connectTelegram: manageAgentsProcedure
    .input(agentConnectTelegramInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.telegram)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Telegram channel not enabled",
        });
      const agent = await ctx.agents.connectTelegram(input.id, input.botToken);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  disconnectTelegram: manageAgentsProcedure
    .input(agentDisconnectTelegramInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.disconnectTelegram(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),
});
