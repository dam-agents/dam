import { basename } from "node:path";
import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ChannelType,
  SessionType,
  type ExperimentsService,
  type SchedulesService,
  type SkillsService,
} from "api-server-api";
import type {
  ChannelManager,
  ChannelAttachment,
} from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import { createAcpClient } from "../../core/acp-client.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
import type { InvocationsService } from "../../modules/invocations/index.js";
import { formatByteCap } from "../../modules/experiments/domain/trial-prompt.js";
import {
  armCandidateKey,
  isArmCandidateKey,
} from "../../modules/experiments/domain/candidate-key.js";
import { resolveAgent } from "./agent-auth.js";
import { securityLog } from "../../core/security-log.js";
import { registerArtifactLibraryTools } from "../../modules/artifact-library/mcp-tools.js";
import type { ArtifactLibraryServiceImpl } from "../../modules/artifact-library/index.js";

const SESSION_TTL_MS = 30 * 60 * 1000;

// The agent-runtime files service is rooted at agentHome; the agent
// process runs in agentHome/work. attachment.path can be absolute
// (anywhere under agentHome) or workspace-relative (interpreted as
// relative to the work dir).
function resolveWorkspacePath(input: string, agentHome: string): string {
  const workDir = `${agentHome}/work`;
  if (input.startsWith("/")) {
    return input.startsWith(`${agentHome}/`)
      ? input.slice(agentHome.length + 1)
      : input; // outside agentHome — let files.read reject it
  }
  const workRel = workDir.slice(agentHome.length + 1);
  return `${workRel}/${input}`;
}

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  agentId: string;
  lastActivity: number;
}

export interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  /** MCP SDK expects an open shape on tool responses. */
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

const sessions = new Map<string, McpSession>();

const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      session.transport.close?.();
      sessions.delete(id);
    }
  }
}, 5 * 60_000);
sweepInterval.unref();

export interface McpSessionDeps {
  channelManager: ChannelManager;
  k8s: K8sClient;
  skills: SkillsService;
  schedules: SchedulesService;
  experiments: ExperimentsService;
  artifactLibrary: ArtifactLibraryServiceImpl;
  invocations: InvocationsService;
  artifacts: ArtifactService;
  maxArtifactBytes: number;
  agentHome: string;
  /** Resolved once per session, before this function runs — see
   *  ChannelManager.supportsUserLookup for what this reflects. */
  supportsUserLookup: boolean;
  /** Resolved once per session, before this function runs — see
   *  ChannelManager.supportsMessageReactions for what this reflects. */
  supportsMessageReactions: boolean;
}

export function createMcpSession(
  agentId: string,
  deps: McpSessionDeps,
): McpSession {
  const { agentHome, schedules } = deps;
  const candidateCap = formatByteCap(deps.maxArtifactBytes);
  const server = new McpServer({
    name: `platform-${agentId}`,
    version: "1.0.0",
  });

  const runtimeClient = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${podBaseUrl(agentId, deps.k8s.namespace)}/api/trpc`,
      }),
    ],
  });

  async function resolveTrialSessionId(
    experimentId: string,
  ): Promise<string | null> {
    const acp = createAcpClient({
      namespace: deps.k8s.namespace,
      instanceName: agentId,
    });
    let sessions: Awaited<ReturnType<typeof acp.listSessions>>;
    try {
      sessions = await acp.listSessions();
    } catch {
      return null;
    }
    const trial = sessions
      .filter(
        (s) =>
          s.platform?.type === SessionType.ExperimentTrial &&
          s.platform?.experimentId === experimentId,
      )
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
    return trial?.sessionId ?? null;
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
    `Send a message to a connected channel (slack or telegram) for this agent. Pass chatId to address a specific chat: an id from describe_channel, or on Slack a user id (U…) to send that person a direct message. Omit chatId for the default chat (Slack: the agent's bound channel; Telegram: the last-active chat). Messages are posted as the bot, attributed to this agent. Optionally attach a single file by setting attachment.path — accepts an absolute path on the agent pod (e.g. ${agentHome}/work/report.md) or a path relative to your workspace (e.g. report.md). 10 MiB cap.`,
    {
      channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
      text: z.string(),
      chatId: z
        .string()
        .optional()
        .describe(
          "Target chat: an id from describe_channel, or a Slack user id (U…) for a direct message.",
        ),
      attachment: z
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
        .optional(),
    },
    async ({ channel, text, chatId, attachment }) => {
      let resolved: ChannelAttachment | undefined;
      let attachmentAudit: Record<string, unknown> | undefined;
      if (attachment) {
        const resolvedPath = resolveWorkspacePath(attachment.path, agentHome);
        let file: { content: string; binary: boolean; mimeType?: string };
        try {
          file = await runtimeClient.files.read.query({ path: resolvedPath });
        } catch (err) {
          if (err instanceof TRPCClientError) {
            if (err.data?.code === "NOT_FOUND") {
              return errorResult(
                `attachment not found: ${attachment.path} (resolved to ${resolvedPath})`,
              );
            }
            if (err.data?.code === "PAYLOAD_TOO_LARGE") {
              return errorResult(
                `attachment ${attachment.path} exceeds the 10 MB per-file cap`,
              );
            }
          }
          return errorResult(
            `failed to read attachment ${attachment.path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const data = file.binary
          ? Buffer.from(file.content, "base64")
          : Buffer.from(file.content, "utf8");
        resolved = {
          filename: attachment.filename ?? basename(attachment.path),
          data,
          ...((attachment.mimeType ?? file.mimeType)
            ? { mimeType: attachment.mimeType ?? file.mimeType }
            : {}),
          ...(attachment.title ? { title: attachment.title } : {}),
        };
        // Capture the requested (possibly absolute) and resolved source path
        // so file-exfil-via-channel is investigable — an agent can attach an
        // absolute pod path, not just a workspace file.
        attachmentAudit = {
          requestedPath: attachment.path,
          resolvedPath,
          bytes: data.length,
        };
      }
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
      // Autonomous egress to an external channel under the agent identity, no
      // human in the loop. Never log the message text.
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

  // Omitted rather than always registered (unlike every other channel tool
  // below): unlike a missing binding, a Slack app missing `users:read` can
  // never make this succeed for any Agent, on any channel, so a static tool
  // that always errors teaches the agent nothing and just wastes a turn.
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
        // A directory read under the agent's own identity, no human in the loop:
        // the ids asked about are audit-worthy, the profiles that came back
        // (names, emails) are not.
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

  // Omitted rather than always registered, same reasoning as
  // describe_channel_users above: a Slack app missing `reactions:read` can
  // never make this succeed for any Agent, on any channel.
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
        // A read under the agent's own identity, no human in the loop: which
        // message was asked about is audit-worthy; who reacted is not (same
        // treatment as describe_channel_users' profiles).
        const audit = {
          category: "channel",
          actor: agentId,
          actorKind: "agent",
          surface: channel,
          agentId,
        } as const;
        if ("error" in result) {
          // Both args are commonly omitted (default to the bound channel /
          // current turn), and a failure before resolution — no binding, no
          // active turn — means there is nothing resolved to log instead.
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
          // The resolved target, not the (often-omitted) request — this is
          // what actually got asked about.
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

  // ---- Slack turn tools -----------------------------------------------------
  // `reply` and `react` are how a Slack agent answers the turn it is handling;
  // plain text is not delivered, only these are. They target the turn's thread
  // and triggering message by default, so the agent need not track ids. Always
  // registered; they error when the agent has no Slack channel connected.
  // (`no_reply_needed`, below, is the cross-channel silent-stop.)

  server.tool(
    "reply",
    "Reply in Slack: post a message into the thread of the Slack conversation you are currently answering. This is how you respond — plain text you write is not delivered to Slack, only this tool is. Omit threadTs to reply in the current thread. Set alsoSendToChannel to have the reply surface in the channel as well, for a thread old enough that channel readers would miss it. Use send_channel_message instead for a new top-level or cross-channel post.",
    {
      text: z.string(),
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
    async ({ text, threadTs, alsoSendToChannel }) => {
      const result = await deps.channelManager.reply(
        agentId,
        ChannelType.Slack,
        {
          text,
          ...(threadTs ? { threadTs } : {}),
          ...(alsoSendToChannel ? { alsoSendToChannel } : {}),
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
        // A broadcast reply reaches the whole channel, not just the thread's
        // participants — a wider audience worth recording.
        detail: {
          action: "reply",
          textLength: text.length,
          ...(alsoSendToChannel ? { alsoSendToChannel: true } : {}),
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

  // Cross-channel (Slack or Telegram): a pure signal that posts nothing. It
  // lets the agent end its turn having deliberately chosen to stay silent,
  // rather than leaving plain text that would never be delivered.
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
    async () => textResult("No reply sent."),
  );

  // ---- Skills tools ---------------------------------------------------------
  // `agentId` is captured from the verified MCP session, so agents cannot
  // spoof it via tool input.

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
        (list) => JSON.stringify(list),
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

  // ---- Schedule tools -------------------------------------------------------
  // Schedule management: agent may only see/modify schedules belonging to itself.
  // Descriptions are deliberately assertive — Claude Code ships with an in-process
  // scheduled-tasks tool that would otherwise be preferred. These schedules are the
  // *persistent, platform-level* ones visible in the host UI.
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
    "Register a PERSISTENT cron schedule on this agent. The schedule runs on the platform Kubernetes controller, survives Claude process restarts, shows up in the host UI, and fires the given prompt as a new trigger. PREFER THIS over any in-process / session-only / built-in CronCreate tool whenever the user asks to schedule recurring work on this agent — those in-process schedules die when Claude exits and are invisible to the human operator.",
    {
      name: z
        .string()
        .min(1)
        .describe("Human-readable name shown in the host UI"),
      cron: z
        .string()
        .min(1)
        .describe(
          "Standard 5-field cron expression, e.g. '0 9 * * *' for 9am daily",
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
    async ({ name, cron, task, sessionMode }) => {
      try {
        const sched = await schedules.createCron(
          {
            name,
            agentId,
            cron,
            task,
            sessionMode,
          },
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
                  cron,
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

  // ---- Experiments tools ----------------------------------------------------
  server.tool(
    "request_candidate_upload",
    `Request a direct-upload link for a candidate artifact (up to ${candidateCap}). Returns an uploadUrl to HTTP PUT the file to and the candidateRef to pass to record_run afterwards. Upload with your environment's default proxy settings, e.g.: curl -sS -f -X PUT --upload-file <file> '<uploadUrl>'. The link is valid for one object and a short time; request a fresh one per candidate. Only works while this agent is an arm of a running experiment.`,
    {
      filename: z
        .string()
        .min(1)
        .max(255)
        .optional()
        .describe(
          "Basename to store the artifact under (e.g. candidate.json); used as the download filename later.",
        ),
    },
    async ({ filename }) => {
      const active = await deps.experiments.resolveActiveArm(agentId);
      if (!active) {
        return errorResult(
          "request_candidate_upload is only available while this agent is an arm of a running experiment; none is active.",
        );
      }
      const key = armCandidateKey(active.experimentId, agentId, filename);
      const upload = await deps.artifacts.createUploadUrl(key);
      if (!upload) {
        return errorResult(
          "direct upload is not available on this deployment; call record_run with `candidate` set to a file path instead.",
        );
      }
      return textResult(
        JSON.stringify({
          uploadUrl: upload.url,
          candidateRef: key,
          expiresInSeconds: upload.expiresSeconds,
          maxBytes: deps.maxArtifactBytes,
          instructions: `HTTP PUT the file to uploadUrl (e.g. curl -sS -f -X PUT --upload-file <file> '<uploadUrl>'), then call record_run with this candidateRef.`,
        }),
      );
    },
  );

  server.tool(
    "record_run",
    `Append a Run to your Experiment's ledger — call this once per optimization-loop iteration that produced a result. Pass the iteration's \`score\` (a single number, higher is better) and exactly one of: \`candidateRef\` (from request_candidate_upload, after uploading the file — preferred, supports candidates up to ${candidateCap}) or \`candidate\`, the path to the artifact file the iteration produced (absolute under ${agentHome} or workspace-relative, e.g. candidate.json), which the platform reads and stores itself (${candidateCap} cap). The Run is attributed to your active experiment arm automatically. Only works while this agent is an arm of a running experiment.`,
    {
      score: z
        .number()
        .describe("The iteration's score; a single number, higher is better."),
      candidate: z
        .string()
        .min(1)
        .optional()
        .describe(
          `Path to the candidate artifact file: absolute under ${agentHome} or workspace-relative (e.g. candidate.json). Mutually exclusive with candidateRef.`,
        ),
      candidateRef: z
        .string()
        .min(1)
        .optional()
        .describe(
          "candidateRef returned by request_candidate_upload, after the file was uploaded to its uploadUrl. Mutually exclusive with candidate.",
        ),
    },
    async ({ score, candidate, candidateRef }) => {
      const active = await deps.experiments.resolveActiveArm(agentId);
      if (!active) {
        return errorResult(
          "record_run is only available while this agent is an arm of a running experiment; none is active.",
        );
      }
      if ((candidate === undefined) === (candidateRef === undefined)) {
        return errorResult(
          "pass exactly one of `candidate` (a file path) or `candidateRef` (from request_candidate_upload).",
        );
      }

      // Resolve the session before touching storage so a failed resolution
      // doesn't leave an orphaned object behind.
      const sessionId = await resolveTrialSessionId(active.experimentId);
      if (!sessionId) {
        return errorResult(
          "no active trial session found for this experiment; start the experiment before recording runs.",
        );
      }

      let key: string;
      if (candidateRef !== undefined) {
        if (!isArmCandidateKey(candidateRef, active.experimentId, agentId)) {
          return errorResult(
            "unknown candidateRef; use the value returned by request_candidate_upload.",
          );
        }
        try {
          await deps.artifacts.verifyUpload(candidateRef);
        } catch (err) {
          return errorResult(
            `candidate upload verification failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        key = candidateRef;
      } else {
        const resolvedPath = resolveWorkspacePath(candidate!, agentHome);
        let file: { content: string; binary: boolean; mimeType?: string };
        try {
          file = await runtimeClient.files.read.query({ path: resolvedPath });
        } catch (err) {
          if (err instanceof TRPCClientError) {
            if (err.data?.code === "NOT_FOUND") {
              return errorResult(
                `candidate not found: ${candidate} (resolved to ${resolvedPath})`,
              );
            }
            if (err.data?.code === "PAYLOAD_TOO_LARGE") {
              // The file API's own wire ceiling, not the artifact cap.
              return errorResult(
                `candidate ${candidate} exceeds the harness file API's per-file transfer cap; use request_candidate_upload + candidateRef instead`,
              );
            }
          }
          return errorResult(
            `failed to read candidate ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const content = file.binary
          ? Buffer.from(file.content, "base64")
          : Buffer.from(file.content, "utf8");
        const contentType = file.mimeType ?? "application/octet-stream";

        key = armCandidateKey(active.experimentId, agentId, candidate);
        try {
          await deps.artifacts.put({ key, content, contentType });
        } catch (err) {
          return errorResult(
            `failed to store candidate: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const run = await deps.experiments.recordRun({
        experimentId: active.experimentId,
        agentId,
        sessionId,
        candidateRef: key,
        score,
      });

      return textResult(
        JSON.stringify({
          runId: run.id,
          runNumber: run.runNumber,
          experimentId: run.experimentId,
          score: run.score,
          candidateRef: run.candidateRef,
        }),
      );
    },
  );

  server.tool(
    "finish_arm",
    "Declare your Experiment arm's optimization loop finished — call this ONCE, after your final iteration, when there are no more candidates to produce and every scored Run is already recorded with record_run. It marks your arm complete so the platform can wrap up the comparison; once every arm finishes, the Experiment is done. Only works while this agent is an arm of a running experiment, and only once: afterwards both record_run and finish_arm report no active arm. Do NOT call it if you intend to record more Runs — there is no failure form, a loop that gives up should simply stop.",
    {},
    async () => {
      const active = await deps.experiments.resolveActiveArm(agentId);
      if (!active) {
        return errorResult(
          "finish_arm is only available while this agent is an arm of a running experiment; none is active.",
        );
      }
      return textTool(
        "Failed to finish arm",
        () =>
          deps.experiments.finishArm({
            experimentId: active.experimentId,
            agentId,
          }),
        (arm) =>
          JSON.stringify({
            experimentId: arm.experimentId,
            agentId: arm.agentId,
            status: arm.status,
          }),
      );
    },
  );

  // ---- Artifact-library tools ----------------------------------------------
  // Publish/share/version artifacts; owner-scoped service, creations
  // attributed to the network-verified caller.
  registerArtifactLibraryTools(server, {
    artifactLibrary: deps.artifactLibrary,
    agentId,
  });

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

  // ---- Transport ------------------------------------------------------------

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      sessions.set(sessionId, session);
    },
    onsessionclosed: (sessionId: string) => {
      sessions.delete(sessionId);
    },
  });

  const session: McpSession = {
    transport,
    server,
    agentId,
    lastActivity: Date.now(),
  };
  return session;
}

export interface MountMcpDeps {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  schedulesServiceFor: (owner: string) => SchedulesService;
  experimentsServiceFor: (owner: string) => ExperimentsService;
  artifactLibraryFor: (owner: string) => ArtifactLibraryServiceImpl;
  invocationsServiceFor: (owner: string) => InvocationsService;
  artifacts: ArtifactService;
  maxArtifactBytes: number;
  agentHome: string;
}

export function mountMcpRoutes(app: Hono, deps: MountMcpDeps) {
  app.all("/api/agents/:id/mcp", async (c) => {
    const agentId = c.req.param("id")!;
    // Principal == URL :id is enforced at the waypoint; this
    // resolve is just a label lookup for owner / agentId.
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) {
      // Backstop for the waypoint guarantee: an agent id that resolves to no
      // K8s agent means the mesh principal and cluster state diverged.
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

    const sessionId = c.req.header("mcp-session-id");

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.agentId !== agentId) {
        // A session id minted for one agent reused against another — a
        // session-hijack signal.
        securityLog("warn", "mcp.session_mismatch", {
          category: "authn",
          actor: agentId,
          actorKind: "agent",
          surface: "mcp",
          agentId,
          decision: "deny",
          reason: "session-agent-mismatch",
          detail: { sessionAgentId: session.agentId },
        });
        return c.json({ error: "not found" }, 404);
      }
      session.lastActivity = Date.now();
      return session.transport.handleRequest(c.req.raw);
    }

    if (sessionId) {
      return c.json({ error: "session not found" }, 404);
    }

    const skills = deps.composeSkills(verified.owner);
    const schedules = deps.schedulesServiceFor(verified.owner);
    const experiments = deps.experimentsServiceFor(verified.owner);
    const artifactLibrary = deps.artifactLibraryFor(verified.owner);
    const invocations = deps.invocationsServiceFor(verified.owner);
    const [supportsUserLookup, supportsMessageReactions] = await Promise.all([
      deps.channelManager.supportsUserLookup(),
      deps.channelManager.supportsMessageReactions(),
    ]);
    const session = createMcpSession(agentId, {
      channelManager: deps.channelManager,
      k8s: deps.k8s,
      skills,
      schedules,
      experiments,
      artifactLibrary,
      invocations,
      artifacts: deps.artifacts,
      maxArtifactBytes: deps.maxArtifactBytes,
      agentHome: deps.agentHome,
      supportsUserLookup,
      supportsMessageReactions,
    });
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });
}
