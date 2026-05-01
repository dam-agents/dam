import { basename } from "node:path";
import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ChannelType, type SkillsService } from "api-server-api";
import type { ChannelManager, ChannelAttachment } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import { verifyInstanceToken } from "./instance-auth.js";

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
  instanceId: string;
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
  agentHome: string;
}

export function createMcpSession(instanceId: string, deps: McpSessionDeps): McpSession {
  const { agentHome } = deps;
  const server = new McpServer({
    name: `humr-${instanceId}`,
    version: "1.0.0",
  });

  const runtimeClient = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `http://${podBaseUrl(instanceId, deps.k8s.namespace)}/api/trpc` })],
  });

  server.tool(
    "describe_channel",
    "Describe a channel on this agent instance. Returns { chats: [{ id, title }] } listing authorized chats (DMs/threads/rooms). Use the id as chatId in send_channel_message.",
    { channel: z.enum([ChannelType.Slack, ChannelType.Telegram]) },
    async ({ channel }) => {
      const chats = await deps.channelManager.listConversations(instanceId, channel);
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
      attachment: z.object({
        path: z.string().min(1).describe(`Absolute path under ${agentHome} or workspace-relative (e.g. report.md).`),
        filename: z.string().optional().describe("Name shown in the channel; defaults to the basename of path."),
        mimeType: z.string().optional().describe("Override the runtime-detected MIME type."),
        title: z.string().optional(),
      }).optional(),
    },
    async ({ channel, text, chatId, attachment }) => {
      let resolved: ChannelAttachment | undefined;
      if (attachment) {
        const resolvedPath = resolveWorkspacePath(attachment.path, agentHome);
        let file: { content?: string; binary?: boolean; mimeType?: string };
        try {
          file = await runtimeClient.files.read.query({ path: resolvedPath });
        } catch (err) {
          const msg = err instanceof TRPCClientError && err.data?.code === "NOT_FOUND"
            ? `attachment not found: ${attachment.path} (resolved to ${resolvedPath})`
            : `failed to read attachment ${attachment.path}: ${err instanceof Error ? err.message : String(err)}`;
          return errorResult(msg);
        }
        if (file.content === undefined) {
          return errorResult(`attachment ${attachment.path} is too large or unreadable (runtime returned no content)`);
        }
        const data = file.binary
          ? Buffer.from(file.content, "base64")
          : Buffer.from(file.content, "utf8");
        resolved = {
          filename: attachment.filename ?? basename(attachment.path),
          data,
          ...(attachment.mimeType ?? file.mimeType ? { mimeType: attachment.mimeType ?? file.mimeType } : {}),
          ...(attachment.title ? { title: attachment.title } : {}),
        };
      }
      const result = await deps.channelManager.postMessage(instanceId, channel, text, {
        ...(chatId ? { conversationId: chatId } : {}),
        ...(resolved ? { attachment: resolved } : {}),
      });
      if ("error" in result) return errorResult(result.error);
      return textResult("Message sent");
    },
  );

  // ---- Skills tools ---------------------------------------------------------
  // `instanceId` is captured from the verified MCP session, so agents cannot
  // spoof it via tool input.

  server.tool(
    "list_skill_sources",
    "List the skill sources (public git repos) this instance can install from. Each entry has an id, display name, git URL, and a system flag indicating admin-managed sources.",
    {},
    () =>
      textTool(
        "Failed to list skill sources",
        () => deps.skills.listSources(instanceId),
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
        () => deps.skills.listSkills(sourceId, instanceId),
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
        () => deps.skills.installSkill({ instanceId, source, name, version }),
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
        () => deps.skills.uninstallSkill({ instanceId, source, name }),
        (remaining) => `Uninstalled ${name}. Instance now has ${remaining.length} skill(s).`,
      ),
  );

  server.tool(
    "publish_skill",
    "Publish a locally-authored skill from THIS instance as a pull request on a connected source. Requires the source to have a publish credential configured. Returns the PR URL on success.",
    {
      sourceId: z.string().min(1),
      name: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
    },
    ({ sourceId, name, title, body }) =>
      textTool(
        "Failed to publish skill",
        () => deps.skills.publishSkill({ instanceId, sourceId, name, title, body }),
        (result) => `Published ${name}. PR: ${result.prUrl}`,
      ),
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

  const session: McpSession = { transport, server, instanceId, lastActivity: Date.now() };
  return session;
}

export interface MountMcpDeps {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  agentHome: string;
}

export function mountMcpRoutes(app: Hono, deps: MountMcpDeps) {
  app.all("/api/instances/:id/mcp", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice(7);

    const instanceId = c.req.param("id")!;
    const verified = await verifyInstanceToken(deps.k8s, instanceId, token);
    if (!verified) {
      return c.json({ error: "not found" }, 404);
    }

    const sessionId = c.req.header("mcp-session-id");

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.instanceId !== instanceId) {
        return c.json({ error: "not found" }, 404);
      }
      session.lastActivity = Date.now();
      return session.transport.handleRequest(c.req.raw);
    }

    if (sessionId) {
      return c.json({ error: "session not found" }, 404);
    }

    const skills = deps.composeSkills(verified.owner);
    const session = createMcpSession(instanceId, {
      channelManager: deps.channelManager,
      k8s: deps.k8s,
      skills,
      agentHome: deps.agentHome,
    });
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });
}
