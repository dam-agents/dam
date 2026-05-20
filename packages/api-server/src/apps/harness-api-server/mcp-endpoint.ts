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
  type SchedulesService,
  type SkillsService,
} from "api-server-api";
import type {
  ChannelManager,
  ChannelAttachment,
} from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import { resolveAgent } from "./agent-auth.js";

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
      return `the instance must be running to manage skills: ${err.message}`;
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
  agentHome: string;
}

export function createMcpSession(
  agentId: string,
  deps: McpSessionDeps,
): McpSession {
  const { agentHome, schedules } = deps;
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

  server.tool(
    "describe_channel",
    "Describe a channel on this agent instance. Returns { chats: [{ id, title }] } listing authorized chats (DMs/threads/rooms). Use the id as chatId in send_channel_message.",
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
    `Send a message to a connected channel (slack or telegram) for this agent instance. Pass chatId to address a specific chat (get ids from describe_channel); omit to use the last-active chat. Optionally attach a single file by setting attachment.path — accepts an absolute path on the agent pod (e.g. ${agentHome}/work/report.md) or a path relative to your workspace (e.g. report.md). 10 MiB cap.`,
    {
      channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
      text: z.string(),
      chatId: z.string().optional(),
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
      if (attachment) {
        const resolvedPath = resolveWorkspacePath(attachment.path, agentHome);
        let file: { content?: string; binary?: boolean; mimeType?: string };
        try {
          file = await runtimeClient.files.read.query({ path: resolvedPath });
        } catch (err) {
          const msg =
            err instanceof TRPCClientError && err.data?.code === "NOT_FOUND"
              ? `attachment not found: ${attachment.path} (resolved to ${resolvedPath})`
              : `failed to read attachment ${attachment.path}: ${err instanceof Error ? err.message : String(err)}`;
          return errorResult(msg);
        }
        if (file.content === undefined) {
          return errorResult(
            `attachment ${attachment.path} is too large or unreadable (runtime returned no content)`,
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
      if ("error" in result) return errorResult(result.error);
      return textResult("Message sent");
    },
  );

  // ---- Skills tools ---------------------------------------------------------
  // `agentId` is captured from the verified MCP session, so agents cannot
  // spoof it via tool input.

  server.tool(
    "list_skill_sources",
    "List the skill sources (public git repos) this instance can install from. Each entry has an id, display name, git URL, and a system flag indicating admin-managed sources.",
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
        () => deps.skills.listSkills(sourceId, agentId),
        (list) => JSON.stringify(list),
      ),
  );

  server.tool(
    "install_skill",
    "Install a skill onto THIS running agent instance. Files land on the pod's persistent volume at the agent's configured skill path; the harness picks them up on the next session.",
    {
      source: z.string().url(),
      name: z.string().min(1),
      version: z.string().min(1),
    },
    ({ source, name, version }) =>
      textTool(
        "Failed to install skill",
        () => deps.skills.installSkill({ agentId, source, name, version }),
        (installed) =>
          `Installed ${name} @ ${version.slice(0, 8)}. Instance now has ${installed.length} skill(s).`,
      ),
  );

  server.tool(
    "uninstall_skill",
    "Uninstall a skill from THIS agent instance. Removes the directory from the pod and drops the entry from the instance spec.",
    {
      source: z.string().url(),
      name: z.string().min(1),
    },
    ({ source, name }) =>
      textTool(
        "Failed to uninstall skill",
        () => deps.skills.uninstallSkill({ agentId, source, name }),
        (remaining) =>
          `Uninstalled ${name}. Instance now has ${remaining.length} skill(s).`,
      ),
  );

  server.tool(
    "publish_skill",
    "Open a pull request that adds an existing on-disk skill from THIS instance to a connected source. PRECONDITION: the skill directory (SKILL.md + supporting files) must already exist under one of your configured skill paths — author the files first using your normal file-writing tools, then call this. This tool only ships an already-authored skill upstream; it does not create or scaffold one. Requires the source to have a publish credential configured. Returns the PR URL on success.",
    {
      sourceId: z.string().min(1),
      name: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
    },
    ({ sourceId, name, title, body }) =>
      textTool(
        "Failed to publish skill",
        () =>
          deps.skills.publishSkill({ agentId, sourceId, name, title, body }),
        (result) => `Published ${name}. PR: ${result.prUrl}`,
      ),
  );

  // ---- Schedule tools -------------------------------------------------------
  // Schedule management: agent may only see/modify schedules belonging to its own instance.
  // Descriptions are deliberately assertive — Claude Code ships with an in-process
  // scheduled-tasks tool that would otherwise be preferred. These schedules are the
  // *persistent, platform-level* ones visible in the host UI.
  server.tool(
    "list_schedules",
    "List all platform schedules registered for this agent instance. These are persistent cron schedules visible in the host UI (not in-session or in-process cron tools).",
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
    "Register a PERSISTENT cron schedule on this agent instance. The schedule runs on the platform Kubernetes controller, survives Claude process restarts, shows up in the host UI, and fires the given prompt as a new trigger. PREFER THIS over any in-process / session-only / built-in CronCreate tool whenever the user asks to schedule recurring work on this agent — those in-process schedules die when Claude exits and are invisible to the human operator.",
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
        const sched = await schedules.createCron({
          name,
          agentId,
          cron,
          task,
          sessionMode,
          createdBy: "agent",
        });
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
    "Enable or disable a platform schedule by id. Only affects schedules belonging to this instance.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const existing = await schedules.get(id);
      if (!existing || existing.agentId !== agentId) {
        return {
          content: [
            {
              type: "text" as const,
              text: `schedule ${id} not found on this instance`,
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
    "Delete a platform schedule by id. Only affects schedules belonging to this instance.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const existing = await schedules.get(id);
      if (!existing || existing.agentId !== agentId) {
        return {
          content: [
            {
              type: "text" as const,
              text: `schedule ${id} not found on this instance`,
            },
          ],
          isError: true,
        };
      }
      await schedules.delete(id);
      return { content: [{ type: "text" as const, text: `deleted ${id}` }] };
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
  agentHome: string;
}

export function mountMcpRoutes(app: Hono, deps: MountMcpDeps) {
  app.all("/api/agents/:id/mcp", async (c) => {
    const agentId = c.req.param("id")!;
    // ADR-041: principal == URL :id is enforced at the waypoint; this
    // resolve is just a label lookup for owner / agentId.
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) {
      return c.json({ error: "not found" }, 404);
    }

    const sessionId = c.req.header("mcp-session-id");

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.agentId !== agentId) {
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
    const session = createMcpSession(agentId, {
      channelManager: deps.channelManager,
      k8s: deps.k8s,
      skills,
      schedules,
      agentHome: deps.agentHome,
    });
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });
}
