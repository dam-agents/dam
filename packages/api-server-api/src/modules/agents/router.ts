import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
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
    state: agent.state,
    error: agent.error,
    contributionFailures: agent.contributionFailures,
    channels: agent.channels,
    allowedUserEmails: agent.allowedUserEmails,
  };
}

export const agentsRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    const agents = await ctx.agents.list();
    return agents.map(toView);
  }),

  get: t.procedure.input(agentGetInputSchema).query(async ({ ctx, input }) => {
    const agent = await ctx.agents.get(input.id);
    if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
    return toView(agent);
  }),

  create: t.procedure
    .input(agentCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.create(input);
      return toView(agent);
    }),

  update: t.procedure
    .input(agentUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.update(input);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  delete: t.procedure
    .input(agentDeleteInputSchema)
    .mutation(({ ctx, input }) => ctx.agents.delete(input.id)),

  restart: t.procedure
    .input(agentRestartInputSchema)
    .mutation(async ({ ctx, input }) => {
      const ok = await ctx.agents.restart(input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
    }),

  wake: t.procedure
    .input(agentWakeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.wake(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  connectSlack: t.procedure
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

  disconnectSlack: t.procedure
    .input(agentDisconnectSlackInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.disconnectSlack(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  connectTelegram: t.procedure
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

  disconnectTelegram: t.procedure
    .input(agentDisconnectTelegramInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.disconnectTelegram(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),
});
