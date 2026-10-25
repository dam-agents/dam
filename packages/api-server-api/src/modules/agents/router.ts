import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { match } from "ts-pattern";
import {
  agentPermission,
  agentTarget,
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
  signedInProcedure,
} from "../../auth-procedures.js";
import {
  agentBackgroundWorkInputSchema,
  agentBindSlackChannelInputSchema,
  agentBindTelegramChatInputSchema,
  agentListTelegramChatsInputSchema,
  agentUnbindTelegramChatInputSchema,
  agentConnectSlackInputSchema,
  agentCreateInputSchema,
  agentDeleteInputSchema,
  agentDisconnectSlackInputSchema,
  agentGetInputSchema,
  agentLeaveInputSchema,
  agentListInputSchema,
  agentSetEditorsInputSchema,
  agentRestartInputSchema,
  agentPeekBindFlowInputSchema,
  agentUpdateInputSchema,
  agentSetCredentialInjectionInputSchema,
  agentSetEnvInputSchema,
  agentSetSecretRefInputSchema,
  agentSetWhisperInputSchema,
  agentSetDisabledInputSchema,
  agentSleepInputSchema,
  agentUpgradeInputSchema,
  agentWakeInputSchema,
  agentRetryWorkspaceInputSchema,
} from "./schemas.js";
import type { ApiContext } from "../../context.js";
import type { AgentUpdateInput } from "./types.js";
import { AGENT_PERMISSIONS } from "./permissions.js";
import { listedAgents, toAgentView, toListedAgentView } from "./view.js";

async function updated(ctx: ApiContext, patch: AgentUpdateInput) {
  const agent = await ctx.agents.update(patch);
  if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
  return toAgentView(agent);
}

export const agentsRouter = t.router({
  list: readAgentProcedure
    .input(agentListInputSchema)
    .query(async ({ ctx, input }) => {
      const [listed, targets] = await Promise.all([
        ctx.agents.listWithAccess(input?.scope ?? "mine"),
        ctx.invocationsQuery.listTargets(),
      ]);
      const driverByTarget = new Map(
        targets.map((t) => [t.targetAgentId, t.driverAgentId]),
      );
      const shown = new Set(
        listedAgents(
          listed.map((l) => l.agent),
          ctx.user.agentIds,
        ).map((agent) => agent.id),
      );
      return listed
        .filter((l) => shown.has(l.agent.id))
        .map((l) =>
          toListedAgentView(l, driverByTarget.get(l.agent.id) ?? null),
        );
    }),

  runtimeFleet: readAgentProcedure.query(({ ctx }) =>
    ctx.agents.runtimeFleet(
      ctx.user.agentIds === "*" ? undefined : ctx.user.agentIds,
    ),
  ),

  get: readAgentProcedure
    .input(agentGetInputSchema)
    .query(async ({ ctx, input }) => {
      checkAgentBinding(ctx, input.id);
      const [listed, targets] = await Promise.all([
        ctx.agents.getWithAccess(input.id),
        ctx.invocationsQuery.listTargets(),
      ]);
      if (!listed) throw new TRPCError({ code: "NOT_FOUND" });
      const driver = targets.find((t) => t.targetAgentId === listed.agent.id);
      return toListedAgentView(listed, driver?.driverAgentId ?? null);
    }),

  setEditors: signedInProcedure
    .input(agentSetEditorsInputSchema)
    .use(agentPermission("editors", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.agents.setEditors(input.id, input.editors);
      if (res.ok) return { editors: res.value };
      return match(res.error)
        .with({ type: "AgentNotFound" }, () => {
          throw new TRPCError({ code: "NOT_FOUND" });
        })
        .with({ type: "OwnEmail" }, () => {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You already own this agent.",
          });
        })
        .exhaustive();
    }),

  leave: signedInProcedure
    .input(agentLeaveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.agents.leave(input.id);
      if (res.ok) return res.value;
      return match(res.error)
        .with({ type: "AgentNotFound" }, { type: "NotAnEditor" }, () => {
          throw new TRPCError({ code: "NOT_FOUND" });
        })
        .exhaustive();
    }),

  backgroundWork: readAgentProcedure
    .input(agentBackgroundWorkInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.id)))
    .query(async ({ ctx, input }) => {
      checkAgentBinding(ctx, input.id);
      const work = await ctx.agents.backgroundWork(input.id);
      if (work === null) throw new TRPCError({ code: "NOT_FOUND" });
      return work;
    }),

  create: manageAgentsProcedure
    .input(agentCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.create(input);
      return toListedAgentView({
        agent,
        access: {
          role: "owner",
          editors: [],
          permissions: [...AGENT_PERMISSIONS],
        },
      });
    }),

  update: manageAgentsProcedure
    .input(agentUpdateInputSchema)
    .use(agentPermission("settings", (input) => agentTarget(input.id)))
    .mutation(({ ctx, input }) => updated(ctx, input)),

  setEnv: manageAgentsProcedure
    .input(agentSetEnvInputSchema)
    .use(agentPermission("envVars", (input) => agentTarget(input.id)))
    .mutation(({ ctx, input }) => updated(ctx, input)),

  setSecretRef: manageAgentsProcedure
    .input(agentSetSecretRefInputSchema)
    .use(agentPermission("secretRef", (input) => agentTarget(input.id)))
    .mutation(({ ctx, input }) => updated(ctx, input)),

  setCredentialInjection: manageAgentsProcedure
    .input(agentSetCredentialInjectionInputSchema)
    .use(
      agentPermission("credentialInjection", (input) => agentTarget(input.id)),
    )
    .mutation(({ ctx, input }) => updated(ctx, input)),

  setWhisper: manageAgentsProcedure
    .input(agentSetWhisperInputSchema)
    .use(agentPermission("channels", (input) => agentTarget(input.id)))
    .mutation(({ ctx, input }) => updated(ctx, input)),

  delete: manageAgentsProcedure
    .input(agentDeleteInputSchema)
    .use(agentPermission("delete", (input) => agentTarget(input.id)))
    .mutation(({ ctx, input }) => ctx.agents.delete(input.id)),

  restart: manageAgentsProcedure
    .input(agentRestartInputSchema)
    .use(agentPermission("lifecycle", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      const ok = await ctx.agents.restart(input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
    }),

  wake: manageAgentsProcedure
    .input(agentWakeInputSchema)
    .use(agentPermission("lifecycle", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.agents.wake(input.id);
      if (res.ok) return toAgentView(res.value);
      if (res.error.type === "AgentNotFound")
        throw new TRPCError({ code: "NOT_FOUND" });
      throw new TRPCError({
        code: "CONFLICT",
        message: "This agent is disabled; enable it to wake it",
      });
    }),

  retryWorkspace: manageAgentsProcedure
    .input(agentRetryWorkspaceInputSchema)
    .use(agentPermission("lifecycle", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.retryWorkspace(input.id, input.kind);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toAgentView(agent);
    }),

  sleep: manageAgentsProcedure
    .input(agentSleepInputSchema)
    .use(agentPermission("lifecycle", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.sleep(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toAgentView(agent);
    }),

  setDisabled: manageAgentsProcedure
    .input(agentSetDisabledInputSchema)
    .use(agentPermission("lifecycle", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.agents.setDisabled(input.id, input.disabled);
      if (res.ok) return toAgentView(res.value);
      throw new TRPCError({ code: "NOT_FOUND" });
    }),

  upgrade: manageAgentsProcedure
    .input(agentUpgradeInputSchema)
    .use(agentPermission("lifecycle", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.agents.upgrade(input.id, input.expectedToImage);
      if (res.ok) return toAgentView(res.value);
      switch (res.error.type) {
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "TemplateNotFound":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No template to update from",
          });
        case "TemplateMoved":
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The template changed since you reviewed the update — check the new version and retry",
          });
      }
    }),

  connectSlack: manageAgentsProcedure
    .input(agentConnectSlackInputSchema)
    .use(agentPermission("channels", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.slack)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Slack app token not configured",
        });
      const res = await ctx.agents.connectSlack(
        input.id,
        input.slackChannelId,
        input.ambient,
        input.customEmoji,
      );
      if (res.ok) return toAgentView(res.value);
      switch (res.error.type) {
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "ChannelAlreadyBound":
          throw new TRPCError({
            code: "CONFLICT",
            message: "This agent is already connected to that Slack channel",
          });
        case "WorkspaceUnresolved":
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "No connected Slack workspace can see that conversation — check the id, and invite the bot to the channel first if it is private",
          });
        case "WorkspaceUnreachable":
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message:
              "Slack could not be asked which workspace that conversation belongs to. The conversation id may well be right — try again, and if it persists check that the app still holds the channels:read and groups:read scopes",
          });
        case "NoSlackWorkspace":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "No Slack workspace is connected yet — an operator connects one under Settings → Slack workspaces",
          });
        case "SlackAccountUnlinked":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Link your Slack account first: run the app's login command in Slack, then try again. Or run its bind command in the channel itself",
          });
        case "NotChannelMember":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "You can connect only a channel you and the bot are both in. Join the channel, or invite the bot to it, then try again",
          });
        case "MembershipUnchecked":
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message:
              "Slack could not be asked whether you are in that channel. Try again",
          });
      }
    }),

  disconnectSlack: manageAgentsProcedure
    .input(agentDisconnectSlackInputSchema)
    .use(agentPermission("channels", (input) => agentTarget(input.id)))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.disconnectSlack(
        input.id,
        input.slackChannelId,
      );
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toAgentView(agent);
    }),

  peekSlackBindFlow: manageAgentsProcedure
    .input(agentPeekBindFlowInputSchema)
    .query(({ ctx, input }) => ctx.agents.peekSlackBindFlow(input.flowId)),

  peekTelegramBindFlow: manageAgentsProcedure
    .input(agentPeekBindFlowInputSchema)
    .query(({ ctx, input }) => ctx.agents.peekTelegramBindFlow(input.flowId)),

  bindSlackChannel: manageAgentsProcedure
    .input(agentBindSlackChannelInputSchema)
    .use(agentPermission("channels", (input) => agentTarget(input.agentId)))
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
            message: "That agent is already connected to this channel",
          });
        case "WorkspaceUnresolved":
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message:
              "Could not work out which Slack workspace this conversation belongs to",
          });
        case "WorkspaceUnreachable":
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message:
              "Slack could not be asked which workspace this conversation belongs to",
          });
        case "NoSlackWorkspace":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "No Slack workspace is connected yet — an operator connects one under Settings → Slack workspaces",
          });
      }
    }),

  listTelegramChats: manageAgentsProcedure
    .input(agentListTelegramChatsInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
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
    .use(agentPermission("channels", (input) => agentTarget(input.agentId)))
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
    .use(agentPermission("channels", (input) => agentTarget(input.agentId)))
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
