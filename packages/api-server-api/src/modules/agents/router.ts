import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  agentBindSlackChannelInputSchema,
  agentBindTelegramChatInputSchema,
  agentListTelegramChatsInputSchema,
  agentUnbindTelegramChatInputSchema,
  agentConnectSlackInputSchema,
  agentCreateInputSchema,
  agentDeleteInputSchema,
  agentDisconnectSlackInputSchema,
  agentGetInputSchema,
  agentRestartInputSchema,
  agentUpdateInputSchema,
  agentPauseInputSchema,
  agentStopInputSchema,
  agentUpgradeInputSchema,
  agentWakeInputSchema,
} from "./schemas.js";
import type { Agent } from "./types.js";

export function toAgentView(agent: Agent, spawnedBy: string | null = null) {
  return {
    // The driver that spawned this agent as an Invocation target, joined in
    // from the invocations table at read time — Postgres stays the single
    // source of the edge. Null for every agent a user created.
    spawnedBy,
    id: agent.id,
    name: agent.name,
    templateId: agent.templateId ?? null,
    templateUpdate: agent.templateUpdate ?? null,
    image: agent.spec.image,
    description: agent.spec.description,
    env: agent.spec.env,
    // Effective idle timeout (0 = never): the per-agent override resolved against the global default by the service.
    hibernationTimeoutMin: agent.effectiveHibernationTimeoutMin,
    grantedSecretIds: agent.spec.grantedSecretIds ?? [],
    grantedConnectionIds: agent.spec.grantedConnectionIds ?? [],
    state: agent.state,
    error: agent.error,
    overBudget: agent.overBudget,
    overBudgetMessage: agent.overBudgetMessage,
    size: {
      cpu: agent.spec.resources?.limits?.cpu,
      memory: agent.spec.resources?.limits?.memory,
    },
    podTerminationReason: agent.podTerminationReason,
    contributionFailures: agent.contributionFailures,
    channels: agent.channels,
    allowedUserEmails: agent.allowedUserEmails,
    kind: agent.kind,
    kbTemplateId: agent.kbTemplateId ?? null,
  };
}

export const agentsRouter = t.router({
  list: readAgentProcedure.query(async ({ ctx }) => {
    // The row is written before the target agent exists, so this join can
    // never see an unattributed target — no flash of a temporary spawn
    // rendering as a plain sandbox.
    const [agents, targets] = await Promise.all([
      ctx.agents.list(),
      ctx.invocationsQuery.listTargets(),
    ]);
    const driverByTarget = new Map(
      targets.map((t) => [t.targetAgentId, t.driverAgentId]),
    );
    // For agent-bound keys, narrow the listing to the bound set so callers
    // don't see agents they couldn't operate on anyway.
    const allowed =
      ctx.user.agentIds === "*"
        ? agents
        : agents.filter((a) => ctx.user.agentIds.includes(a.id));
    return allowed.map((agent) =>
      toAgentView(agent, driverByTarget.get(agent.id) ?? null),
    );
  }),

  get: readAgentProcedure
    .input(agentGetInputSchema)
    .query(async ({ ctx, input }) => {
      checkAgentBinding(ctx, input.id);
      const [agent, targets] = await Promise.all([
        ctx.agents.get(input.id),
        ctx.invocationsQuery.listTargets(),
      ]);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      const driver = targets.find((t) => t.targetAgentId === agent.id);
      return toAgentView(agent, driver?.driverAgentId ?? null);
    }),

  create: manageAgentsProcedure
    .input(agentCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.create(input);
      return toAgentView(agent);
    }),

  update: manageAgentsProcedure
    .input(agentUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.update(input);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toAgentView(agent);
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
      return toAgentView(agent);
    }),

  stop: manageAgentsProcedure
    .input(agentStopInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.stop(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toAgentView(agent);
    }),

  pause: manageAgentsProcedure
    .input(agentPauseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.pause(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toAgentView(agent);
    }),

  upgrade: manageAgentsProcedure
    .input(agentUpgradeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.agents.upgrade(input.id, input.expectedToImage);
      if (res.ok) return toAgentView(res.value);
      switch (res.error.type) {
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "TemplateNotFound":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No template to upgrade from",
          });
        case "TemplateMoved":
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The template changed since you reviewed the upgrade — check the new version and retry",
          });
      }
    }),

  connectSlack: manageAgentsProcedure
    .input(agentConnectSlackInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.slack)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Slack app token not configured",
        });
      const res = await ctx.agents.connectSlack(
        input.id,
        input.slackChannelId,
        input.mode,
        input.ambient,
      );
      if (res.ok) return toAgentView(res.value);
      switch (res.error.type) {
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "ChannelAlreadyBound":
          throw new TRPCError({
            code: "CONFLICT",
            message: "Slack channel already bound",
          });
        case "ModeChangeRequiresRebind":
          // PRECONDITION_FAILED so CLI/UI relay this message verbatim instead
          // of collapsing it into the already-bound CONFLICT copy.
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Access mode is fixed per binding — disconnect the channel first",
          });
      }
    }),

  disconnectSlack: manageAgentsProcedure
    .input(agentDisconnectSlackInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.disconnectSlack(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toAgentView(agent);
    }),

  bindSlackChannel: manageAgentsProcedure
    .input(agentBindSlackChannelInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.slack)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Slack app token not configured",
        });
      const res = await ctx.agents.bindSlackChannel(
        input.agentId,
        input.flowId,
      );
      if (res.ok) return res.value;
      switch (res.error.type) {
        case "FlowInvalid":
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Bind link is invalid or expired — run the bind command again in Slack",
          });
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "ChannelAlreadyBound":
          throw new TRPCError({
            code: "CONFLICT",
            message: "This channel is already connected to an agent",
          });
      }
    }),

  listTelegramChats: manageAgentsProcedure
    .input(agentListTelegramChatsInputSchema)
    .query(async ({ ctx, input }) => {
      if (!ctx.channels.available.telegram)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Telegram bot not configured",
        });
      const res = await ctx.agents.listTelegramChats(input.agentId);
      if (res.ok) return res.value;
      switch (res.error.type) {
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "TelegramUnavailable":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Telegram bot is not running",
          });
      }
    }),

  unbindTelegramChat: manageAgentsProcedure
    .input(agentUnbindTelegramChatInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.telegram)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Telegram bot not configured",
        });
      const res = await ctx.agents.unbindTelegramChat(
        input.agentId,
        input.conversationId,
      );
      if (res.ok) return res.value;
      switch (res.error.type) {
        case "AgentNotFound":
        case "ChatNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
      }
    }),

  bindTelegramChat: manageAgentsProcedure
    .input(agentBindTelegramChatInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.telegram)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Telegram bot not configured",
        });
      const res = await ctx.agents.bindTelegramChat(
        input.agentId,
        input.flowId,
      );
      if (res.ok) return res.value;
      switch (res.error.type) {
        case "FlowInvalid":
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Bind link is invalid or expired — run the bind command again in Telegram",
          });
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "ChatAlreadyBound":
          throw new TRPCError({
            code: "CONFLICT",
            message: "This chat is already connected to another agent",
          });
      }
    }),
});
