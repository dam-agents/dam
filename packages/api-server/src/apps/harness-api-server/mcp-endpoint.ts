import { basename } from "node:path";
import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import {
  AGENT_HOME_DIR,
  AGENT_WORK_DIR,
  type AppRouter,
} from "agent-runtime-api";
import type { ExperimentsService } from "api-server-api";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ChannelType,
  quietWindowSchema,
  type SchedulesService,
  type SkillsService,
} from "api-server-api";
import type {
  ChannelManager,
  ChannelAttachment,
} from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { InvocationsService } from "../../modules/invocations/index.js";
import { resolveAgent } from "./agent-auth.js";
import { securityLog } from "../../core/security-log.js";
import { registerArtifactLibraryTools } from "../../modules/artifact-library/mcp-tools.js";
import type { ArtifactLibraryServiceImpl } from "../../modules/artifact-library/index.js";
import {
  registerKbShareTools,
  type KbShareAgentOps,
} from "../../modules/kb-shares/index.js";

function resolveWorkspacePath(input: string): string {
  const agentHome = AGENT_HOME_DIR;
  const workDir = AGENT_WORK_DIR;
  if (input.startsWith("/")) {
    return input.startsWith(`${agentHome}/`)
      ? input.slice(agentHome.length + 1)
      : input;
  }
  const workRel = workDir.slice(agentHome.length + 1);
  return `${workRel}/${input}`;
}

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

export interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function textResult(text: string): ToolContent {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): ToolContent {
  return { content: [{ type: "text", text }], isError: true };
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof TRPCError) {
    if (err.code === "PRECONDITION_FAILED") {
      return `the agent must be running to manage skills: ${err.message}`;
    }
    if (err.code === "NOT_FOUND") return `not found: ${err.message}`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export async function textTool<T>(
  fallback: string,
  call: () => Promise<T>,
  format: (result: T) => string,
): Promise<ToolContent> {
  try {
    return textResult(format(await call()));
  } catch (err) {
    return errorResult(errMessage(err, fallback));
  }
}

export interface McpSessionDeps {
  channelManager: ChannelManager;
  k8s: K8sClient;
  skills: SkillsService;
  schedules: SchedulesService;
  artifactLibrary: ArtifactLibraryServiceImpl;
  invocations: InvocationsService;
  experiments: ExperimentsService;
  kbShares: KbShareAgentOps | null;
  agentHome: string;
  supportsUserLookup: boolean;
  supportsMessageReactions: boolean;
}

export function createMcpSession(
  agentId: string,
  deps: McpSessionDeps,
): McpSession {
  const { agentHome, schedules } = deps;
  const server = new McpServer(
    {
      name: `platform-${agentId}`,
      version: "1.0.0",
    },
    deps.kbShares
      ? {
          instructions:
            "This agent is a knowledge base. You can publish it as a read-only endpoint teammates query without copying it: call share_knowledge_base to start sharing (idempotent), refresh_knowledge_base_share after substantial edits, and get_share_status to check. Sharing is read-only — curation stays with you — and the share link itself is only revealed to the owner in the UI, never to you.",
        }
      : undefined,
  );

  const runtimeClient = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${podBaseUrl(agentId, deps.k8s.namespace)}/api/trpc`,
      }),
    ],
  });

  const attachmentInput = z
    .object({
      path: z
        .string()
        .min(1)
        .describe(
          `Absolute path under ${agentHome} or workspace-relative (e.g. report.md).`,
        ),
      filename: z
        .string()
        .optional()
        .describe(
          "Name shown in the channel; defaults to the basename of path.",
        ),
      mimeType: z
        .string()
        .optional()
        .describe("Override the runtime-detected MIME type."),
      title: z.string().optional(),
    })
    .optional();

  async function loadAttachment(
    attachment: NonNullable<z.infer<typeof attachmentInput>>,
  ): Promise<
    | { resolved: ChannelAttachment; audit: Record<string, unknown> }
    | { error: string }
  > {
    const resolvedPath = resolveWorkspacePath(attachment.path);
    let file: { content: string; binary: boolean; mimeType?: string };
    try {
      file = await runtimeClient.files.read.query({ path: resolvedPath });
    } catch (err) {
      if (err instanceof TRPCClientError) {
        if (err.data?.code === "NOT_FOUND") {
          return {
            error: `attachment not found: ${attachment.path} (resolved to ${resolvedPath})`,
          };
        }
        if (err.data?.code === "PAYLOAD_TOO_LARGE") {
          return {
            error: `attachment ${attachment.path} exceeds the 50 MB per-file cap`,
          };
        }
      }
      return {
        error: `failed to read attachment ${attachment.path}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const data = file.binary
      ? Buffer.from(file.content, "base64")
      : Buffer.from(file.content, "utf8");
    return {
      resolved: {
        filename: attachment.filename ?? basename(attachment.path),
        data,
        ...((attachment.mimeType ?? file.mimeType)
          ? { mimeType: attachment.mimeType ?? file.mimeType }
          : {}),
        ...(attachment.title ? { title: attachment.title } : {}),
      },
      audit: {
        requestedPath: attachment.path,
        resolvedPath,
        bytes: data.length,
      },
    };
  }

  server.tool(
    "describe_channel",
    "Describe a channel on this agent. Returns { chats: [{ id, title }] } listing reachable chats — on Slack the agent's bound channel first, then every other workspace channel the bot is a member of; on Telegram the bound conversations. Use the id as chatId in send_channel_message.",
    { channel: z.enum([ChannelType.Slack, ChannelType.Telegram]) },
    async ({ channel }) => {
      const chats = await deps.channelManager.listConversations(
        agentId,
        channel,
      );
      return textResult(JSON.stringify({ chats }));
    },
  );

  server.tool(
    "send_channel_message",
    `Send a message to a connected channel (slack or telegram) for this agent. Pass chatId to address a specific chat: an id from describe_channel, or on Slack a user id (U…) to send that person a direct message. Omit chatId for the default chat (Slack: the agent's bound channel; Telegram: the last-active chat). Messages are posted as the bot, attributed to this agent. Optionally attach a single file by setting attachment.path — accepts an absolute path on the agent pod (e.g. ${agentHome}/work/report.md) or a path relative to your workspace (e.g. report.md). 50 MB cap.`,
    {
      channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
      text: z.string(),
      chatId: z
        .string()
        .optional()
        .describe(
          "Target chat: an id from describe_channel, or a Slack user id (U…) for a direct message.",
        ),
      attachment: attachmentInput,
    },
    async ({ channel, text, chatId, attachment }) => {
      const loaded = attachment ? await loadAttachment(attachment) : undefined;
      if (loaded && "error" in loaded) return errorResult(loaded.error);
      const resolved = loaded?.resolved;
      const attachmentAudit = loaded?.audit;
      const result = await deps.channelManager.postMessage(
        agentId,
        channel,
        text,
        {
          ...(chatId ? { conversationId: chatId } : {}),
          ...(resolved ? { attachment: resolved } : {}),
        },
      );
      const failed = "error" in result;
      securityLog(failed ? "warn" : "info", "channel.outbound", {
        category: "channel",
        actor: agentId,
        actorKind: "agent",
        surface: channel,
        agentId,
        result: failed ? "failure" : "success",
        detail: {
          ...(chatId ? { conversationId: chatId } : {}),
          hasAttachment: attachmentAudit !== undefined,
          ...(attachmentAudit ? { attachment: attachmentAudit } : {}),
          textLength: text.length,
        },
      });
      if ("error" in result) return errorResult(result.error);
      return textResult("Message sent");
    },
  );

  if (deps.supportsUserLookup) {
    server.tool(
      "describe_channel_users",
      "Look up who a channel's user ids belong to. People reach you as bare ids (Slack `U…`) — in the speaker labels on shared-channel messages, in conversation history, and in mentions inside message text — and this is how you turn those ids into people. Returns { users: [{ id, username, realName, displayName, title, pronouns, email, timezone, statusText, isBot, ... }] }; a field is absent when the person left it unset or the workspace withholds it, and an id that cannot be resolved comes back with an `error` while the rest of the batch still resolves. Look someone up before addressing them by name, attributing work to them, or reasoning about their local time. Slack only.",
      {
        channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
        userIds: z
          .array(z.string().min(1))
          .min(1)
          .max(20)
          .describe(
            'User ids to resolve, e.g. ["U024BE7LH"]. The <@U024BE7LH> form is accepted too.',
          ),
      },
      async ({ channel, userIds }) => {
        const result = await deps.channelManager.describeUsers(
          agentId,
          channel,
          userIds,
        );
        const audit = {
          category: "channel",
          actor: agentId,
          actorKind: "agent",
          surface: channel,
          agentId,
        } as const;
        if ("error" in result) {
          securityLog("warn", "channel.user_lookup", {
            ...audit,
            result: "failure",
            reason: result.error,
            detail: { requested: userIds.length },
          });
          return errorResult(result.error);
        }
        securityLog("info", "channel.user_lookup", {
          ...audit,
          result: "success",
          detail: {
            userIds: result.users.map((u) => u.id),
            resolved: result.users.filter((u) => !u.error).length,
          },
        });
        return textResult(JSON.stringify({ users: result.users }));
      },
    );
  }

  if (deps.supportsMessageReactions) {
    server.tool(
      "describe_message_reactions",
      "Look up who reacted to a message and with what emoji — reactions are otherwise invisible to you; nothing in the message text or conversation history reveals them. Returns { reactions: [{ name, count, users }], conversationId, messageTs }, one reaction entry per emoji used (name is the Slack short name, users the ids who used it) plus the chat and message actually inspected (useful when you omitted one or both), or an error if the message can't be found. Defaults to the message you're currently answering, in the channel you're bound to; pass chatId for another chat the bot can reach (see describe_channel) and messageTs for a specific message — e.g. one you posted earlier and want to check on later, like a weekly signup thread. Slack only.",
      {
        channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
        chatId: z
          .string()
          .optional()
          .describe(
            "Chat containing the message: an id from describe_channel. Omit for the agent's bound channel.",
          ),
        messageTs: z
          .string()
          .optional()
          .describe(
            "Message to inspect. Omit for the message you're currently answering.",
          ),
      },
      async ({ channel, chatId, messageTs }) => {
        const result = await deps.channelManager.describeMessageReactions(
          agentId,
          channel,
          { conversationId: chatId, messageTs },
        );
        const audit = {
          category: "channel",
          actor: agentId,
          actorKind: "agent",
          surface: channel,
          agentId,
        } as const;
        if ("error" in result) {
          securityLog("warn", "channel.reaction_lookup", {
            ...audit,
            result: "failure",
            reason: result.error,
            detail: {
              ...(chatId ? { conversationId: chatId } : {}),
              ...(messageTs ? { messageTs } : {}),
            },
          });
          return errorResult(result.error);
        }
        securityLog("info", "channel.reaction_lookup", {
          ...audit,
          result: "success",
          detail: {
            conversationId: result.conversationId,
            messageTs: result.messageTs,
            reactions: result.reactions.map((r) => ({
              name: r.name,
              count: r.count,
            })),
          },
        });
        return textResult(
          JSON.stringify({
            reactions: result.reactions,
            conversationId: result.conversationId,
            messageTs: result.messageTs,
          }),
        );
      },
    );
  }

  server.tool(
    "reply",
    `Reply in Slack: post a message into the thread of the Slack conversation you are currently answering. This is how you respond — plain text you write is not delivered to Slack, only this tool is. Omit threadTs to reply in the current thread. Set alsoSendToChannel to have the reply surface in the channel as well, for a thread old enough that channel readers would miss it. Optionally attach a single file to the reply by setting attachment.path — accepts an absolute path on the agent pod (e.g. ${agentHome}/work/report.md) or a path relative to your workspace (e.g. report.md); it lands in the same thread. 50 MB cap. Use send_channel_message instead for a new top-level or cross-channel post.`,
    {
      text: z.string(),
      attachment: attachmentInput,
      threadTs: z
        .string()
        .optional()
        .describe(
          "Thread to reply into. Omit for the thread of the message you're answering.",
        ),
      alsoSendToChannel: z
        .boolean()
        .optional()
        .describe(
          'Also surface this reply in the channel, not just inside the thread — Slack\'s "Also send to channel". One post, visible in both places. Use it when the thread is old enough that people watching the channel would otherwise miss the reply; leave it off for ordinary back-and-forth, which would spam the channel.',
        ),
    },
    async ({ text, attachment, threadTs, alsoSendToChannel }) => {
      const loaded = attachment ? await loadAttachment(attachment) : undefined;
      if (loaded && "error" in loaded) return errorResult(loaded.error);
      const result = await deps.channelManager.reply(
        agentId,
        ChannelType.Slack,
        {
          text,
          ...(threadTs ? { threadTs } : {}),
          ...(alsoSendToChannel ? { alsoSendToChannel } : {}),
          ...(loaded ? { attachment: loaded.resolved } : {}),
        },
      );
      const failed = "error" in result;
      securityLog(failed ? "warn" : "info", "channel.outbound", {
        category: "channel",
        actor: agentId,
        actorKind: "agent",
        surface: ChannelType.Slack,
        agentId,
        result: failed ? "failure" : "success",
        detail: {
          action: "reply",
          textLength: text.length,
          ...(alsoSendToChannel ? { alsoSendToChannel: true } : {}),
          hasAttachment: loaded !== undefined,
          ...(loaded ? { attachment: loaded.audit } : {}),
        },
      });
      if ("error" in result) return errorResult(result.error);
      return textResult("Reply posted");
    },
  );

  server.tool(
    "react",
    "React in Slack: add an emoji reaction to a message in the Slack conversation you are answering — a quiet acknowledgement that notifies no one (e.g. eyes on a reported bug, white_check_mark when a task is done). Omit messageTs to react to the message you're currently answering.",
    {
      emoji: z
        .string()
        .describe('Slack emoji short name, no colons (e.g. "eyes").'),
      messageTs: z
        .string()
        .optional()
        .describe(
          "Message to react to. Omit for the message you're currently answering.",
        ),
    },
    async ({ emoji, messageTs }) => {
      const result = await deps.channelManager.react(
        agentId,
        ChannelType.Slack,
        {
          emoji,
          ...(messageTs ? { messageTs } : {}),
        },
      );
      const failed = "error" in result;
      securityLog(failed ? "warn" : "info", "channel.outbound", {
        category: "channel",
        actor: agentId,
        actorKind: "agent",
        surface: ChannelType.Slack,
        agentId,
        result: failed ? "failure" : "success",
        detail: {
          action: "react",
          emoji: emoji.trim().replace(/^:+|:+$/g, ""),
        },
      });
      if ("error" in result) return errorResult(result.error);
      return textResult("Reaction added");
    },
  );

  server.tool(
    "hand_off_to_agent",
    "Hand the Slack message you are answering to another agent connected to the same conversation, when it is better placed to answer than you are. Name the agent as it appears in the conversation. It picks the message up as its own turn and replies in the thread itself, so you post nothing and your turn ends here — do not also reply. Only works while you are answering a Slack message, and only for an agent connected to that same conversation. A message handed to you cannot be handed on again.",
    {
      agent: z
        .string()
        .describe(
          "Name of the agent to hand this to, as it appears in this conversation.",
        ),
      note: z
        .string()
        .optional()
        .describe(
          "Short note to the receiving agent on why you are handing it over. Shown to that agent, not posted in the channel.",
        ),
    },
    async ({ agent, note }) => {
      const result = await deps.channelManager.handOffTurn(
        agentId,
        ChannelType.Slack,
        agent,
        note,
      );
      const failed = "error" in result;
      securityLog(failed ? "warn" : "info", "channel.outbound", {
        category: "channel",
        actor: agentId,
        actorKind: "agent",
        surface: ChannelType.Slack,
        agentId,
        result: failed ? "failure" : "success",
        detail: {
          action: "hand_off_to_agent",
          requested: agent,
          ...(failed ? {} : { handedTo: result.agent }),
        },
      });
      if ("error" in result) return errorResult(result.error);
      return textResult(
        `Handed to ${result.agent}. It picks the turn up from here and answers in the thread, so post nothing further. Your turn ends now; you will not see its reply, and if it cannot pick the turn up the person who asked is told, not you.`,
      );
    },
  );

  server.tool(
    "no_reply_needed",
    "End your turn without sending anything to the channel. Call this when the message doesn't need a response from you — routine chatter that isn't aimed at you, or something another person already handled. Nothing is posted; it just records that you deliberately stayed silent.",
    {
      reason: z
        .string()
        .optional()
        .describe(
          "Optional short note on why no reply was needed (not posted).",
        ),
    },
    async () => {
      await deps.channelManager.declineTurn(agentId, ChannelType.Slack);
      return textResult("No reply sent.");
    },
  );

  server.tool(
    "list_skill_sources",
    "List the skill sources (public git repos) this agent can install from. Each entry has an id, display name, git URL, and a system flag indicating admin-managed sources.",
    {},
    () =>
      textTool(
        "Failed to list skill sources",
        () => deps.skills.listSources(agentId),
        (sources) => JSON.stringify(sources),
      ),
  );

  server.tool(
    "list_skills_in_source",
    "List the skills available inside a connected skill source. Returns each skill's name, description, and the last-touching commit SHA (pass this as `version` to install_skill).",
    { sourceId: z.string() },
    ({ sourceId }) =>
      textTool(
        "Failed to list skills",
        () => deps.skills.list(sourceId, agentId),
        (result) => JSON.stringify(result.skills),
      ),
  );

  server.tool(
    "install_skill",
    "Install a skill onto THIS running agent. Files land on the pod's persistent volume at the agent's configured skill path; the harness picks them up on the next session.",
    {
      source: z.string().url(),
      name: z.string().min(1),
      version: z.string().min(1),
    },
    ({ source, name, version }) =>
      textTool(
        "Failed to install skill",
        () => deps.skills.install({ agentId, source, name, version }),
        (installed) =>
          `Installed ${name} @ ${version.slice(0, 8)}. Agent now has ${installed.length} skill(s).`,
      ),
  );

  server.tool(
    "uninstall_skill",
    "Uninstall a skill from THIS agent. Removes the directory from the pod and drops the entry from the agent spec.",
    {
      source: z.string().url(),
      name: z.string().min(1),
    },
    ({ source, name }) =>
      textTool(
        "Failed to uninstall skill",
        () => deps.skills.uninstall({ agentId, source, name }),
        (remaining) =>
          `Uninstalled ${name}. Agent now has ${remaining.length} skill(s).`,
      ),
  );

  server.tool(
    "publish_skill",
    "Open a pull request that adds an existing on-disk skill from THIS agent to a connected source. PRECONDITION: the skill directory (SKILL.md + supporting files) must already exist under one of your configured skill paths — author the files first using your normal file-writing tools, then call this. This tool only ships an already-authored skill upstream; it does not create or scaffold one. Requires the source to have a publish credential configured. Returns the PR URL on success.",
    {
      sourceId: z.string().min(1),
      name: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
    },
    ({ sourceId, name, title, body }) =>
      textTool(
        "Failed to publish skill",
        () => deps.skills.publish({ agentId, sourceId, name, title, body }),
        (result) => `Published ${name}. PR: ${result.prUrl}`,
      ),
  );

  server.tool(
    "list_schedules",
    "List all platform schedules registered for this agent. These are persistent cron schedules visible in the host UI (not in-session or in-process cron tools).",
    {},
    async () => {
      const list = await schedules.list(agentId);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(list, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "create_schedule",
    "Register a PERSISTENT recurring schedule on this agent. The schedule runs on the platform Kubernetes controller, survives Claude process restarts, shows up in the host UI, and fires the given prompt as a new trigger. PREFER THIS over any in-process / session-only / built-in CronCreate tool whenever the user asks to schedule recurring work on this agent — those in-process schedules die when Claude exits and are invisible to the human operator. Pass exactly one of `cron` or `rrule`+`timezone`: prefer `rrule`+`timezone` whenever the user gives you a time in their own local terms ('every weekday at 9am', 'Mondays at 6pm Europe/Prague') — it fires at that local wall-clock time year-round, correctly adjusting across DST. `cron` is a legacy, UTC-only fallback: a 9am-local ask has to be hand-converted to UTC and silently drifts by an hour whenever DST flips, so only use it when the user explicitly wants a fixed UTC time.",
    {
      name: z
        .string()
        .min(1)
        .describe("Human-readable name shown in the host UI"),
      cron: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Legacy: standard 5-field cron expression in UTC, e.g. '0 9 * * *' for 9am UTC daily. Mutually exclusive with rrule/timezone.",
        ),
      rrule: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Recommended: RFC 5545 RRULE body, e.g. 'FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0' for 9am Monday and Wednesday. Requires timezone. Mutually exclusive with cron.",
        ),
      timezone: z
        .string()
        .min(1)
        .optional()
        .describe(
          "IANA timezone the rrule fires in, e.g. 'Europe/Prague'. Required with rrule.",
        ),
      quietHours: z
        .array(quietWindowSchema)
        .optional()
        .describe(
          "Optional windows (in `timezone`) during which an rrule occurrence is skipped rather than fired, e.g. to avoid a night-time run.",
        ),
      task: z
        .string()
        .min(1)
        .describe("Prompt the agent will receive when the schedule fires"),
      sessionMode: z
        .enum(["continuous", "fresh"])
        .optional()
        .describe(
          "continuous = resume prior session each tick; fresh = new session per run (default)",
        ),
    },
    async ({ name, cron, rrule, timezone, quietHours, task, sessionMode }) => {
      if ((cron === undefined) === (rrule === undefined)) {
        return errorResult(
          "pass exactly one of `cron` (legacy, UTC) or `rrule` (with `timezone`).",
        );
      }
      if (rrule !== undefined && !timezone) {
        return errorResult("rrule requires timezone.");
      }
      if (cron !== undefined && (timezone || quietHours)) {
        return errorResult(
          "`cron` is UTC-only and ignores `timezone`/`quietHours` — use `rrule` with `timezone` to schedule in a local zone.",
        );
      }
      try {
        const sched =
          rrule !== undefined
            ? await schedules.createRRule(
                {
                  name,
                  agentId,
                  rrule,
                  timezone: timezone!,
                  quietHours,
                  task,
                  sessionMode,
                },
                "agent",
              )
            : await schedules.createCron(
                { name, agentId, cron: cron!, task, sessionMode },
                "agent",
              );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: sched.id,
                  name: sched.name,
                  ...(sched.spec.type === "rrule"
                    ? { rrule: sched.spec.rrule, timezone: sched.spec.timezone }
                    : { cron: sched.spec.cron }),
                  enabled: sched.spec.enabled,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "toggle_schedule",
    "Enable or disable a platform schedule by id. Only affects schedules belonging to this agent.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const existing = await schedules.get(id);
      if (!existing || existing.agentId !== agentId) {
        return {
          content: [
            {
              type: "text" as const,
              text: `schedule ${id} not found on this agent`,
            },
          ],
          isError: true,
        };
      }
      const updated = await schedules.toggle(id);
      if (!updated) {
        return {
          content: [
            { type: "text" as const, text: `schedule ${id} not found` },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { id: updated.id, enabled: updated.spec.enabled },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "delete_schedule",
    "Delete a platform schedule by id. Only affects schedules belonging to this agent.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const existing = await schedules.get(id);
      if (!existing || existing.agentId !== agentId) {
        return {
          content: [
            {
              type: "text" as const,
              text: `schedule ${id} not found on this agent`,
            },
          ],
          isError: true,
        };
      }
      await schedules.delete(id);
      return { content: [{ type: "text" as const, text: `deleted ${id}` }] };
    },
  );

  registerArtifactLibraryTools(server, {
    artifactLibrary: deps.artifactLibrary,
    agentId,
    attachToExperiment: (artifactId, experimentId) =>
      deps.experiments.attachArtifact(agentId, artifactId, experimentId),
  });

  if (deps.kbShares) {
    registerKbShareTools(server, { ops: deps.kbShares, agentId });
  }

  server.tool(
    "report_result",
    "Report this invocation's final result. Pass a single `result` argument: a JSON value conforming to the JSON Schema given in your prompt. The platform validates it structurally: if it conforms, the result is stored and the invocation is marked done; if not, you get back what was wrong so you can call report_result again with a corrected result. The platform decides you are done only when a call passes validation — finishing your turn without calling report_result reports nothing. Only works while this agent is a running invocation target; attribution is automatic from your agent identity.",
    {
      result: z
        .unknown()
        .describe(
          "The result — a JSON value matching the schema in your prompt.",
        ),
    },
    async ({ result }) => {
      const outcome = await deps.invocations.recordResult(agentId, result);
      if (!outcome.ok) {
        return errorResult(
          `report_result rejected: ${outcome.errors ?? "result did not validate"}. Fix the result and call report_result again.`,
        );
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ accepted: true }) }],
      };
    },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  return { transport, server };
}

export interface MountMcpDeps {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  schedulesServiceFor: (owner: string) => SchedulesService;
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  invocationsServiceFor: (owner: string) => InvocationsService;
  experimentsServiceFor: (owner: string) => ExperimentsService;
  kbShareOpsFor: (owner: string) => KbShareAgentOps;
  agentHome: string;
}

export function mountMcpRoutes(app: Hono, deps: MountMcpDeps) {
  app.all("/api/agents/:id/mcp", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) {
      securityLog("warn", "mcp.resolve_fail", {
        category: "authn",
        actor: agentId,
        actorKind: "agent",
        surface: "mcp",
        agentId,
        decision: "deny",
        reason: "agent-unresolved",
      });
      return c.json({ error: "not found" }, 404);
    }

    const skills = deps.composeSkills(verified.owner);
    const schedules = deps.schedulesServiceFor(verified.owner);
    const artifactLibrary = deps.artifactLibraryFor(verified.owner);
    const invocations = deps.invocationsServiceFor(verified.owner);
    const experiments = deps.experimentsServiceFor(verified.owner);
    const [supportsUserLookup, supportsMessageReactions] = await Promise.all([
      deps.channelManager.supportsUserLookup(),
      deps.channelManager.supportsMessageReactions(),
    ]);
    const session = createMcpSession(agentId, {
      channelManager: deps.channelManager,
      k8s: deps.k8s,
      skills,
      schedules,
      artifactLibrary,
      invocations,
      experiments,
      kbShares:
        verified.kind === "knowledge-base"
          ? deps.kbShareOpsFor(verified.owner)
          : null,
      agentHome: deps.agentHome,
      supportsUserLookup,
      supportsMessageReactions,
    });
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });
}
