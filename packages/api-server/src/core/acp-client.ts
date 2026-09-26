import { WebSocket } from "ws";
import { match } from "ts-pattern";
import {
  platformRunResultResponseSchema,
  type AcpPermissionOption,
} from "api-server-api";
import { z } from "zod";
import {
  client,
  type AnyMessage,
  type ClientConnection,
  type ContentBlock,
  type InitializeResponse,
  type McpServer,
  type NewSessionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk";
import { podBaseUrl } from "../modules/agents/infrastructure/k8s.js";
import { getLogger } from "./logger.js";
import { isPlatformMcpTool } from "./platform-mcp.js";
import { securityLog } from "./security-log.js";

const PING_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 2;
const STALL_PROBE_RPC_TIMEOUT_MS = 15_000;
const TURN_STATUS_DEADLINE_MS = 20_000;
const RUN_RESULT_METHOD = "platform/runResult";

const STEER_METHOD = "_session/steering";
const STEER_CEILING_MS = 30_000;

export class AcpSessionLoadError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = "AcpSessionLoadError";
  }
}

export type AcpTurnAbandonCause = "connection-lost" | "stalled";

export class AcpTurnAbandonedError extends Error {
  constructor(
    readonly abandonCause: AcpTurnAbandonCause,
    message: string,
  ) {
    super(message);
    this.name = "AcpTurnAbandonedError";
  }
}

type ConnectionWatch =
  | { kind: "deadline"; ms: number }
  | {
      kind: "turn";
      stallProbeMs: number;
      sessionId: () => string | null;
    };

async function probeTurnStatus(
  connection: ClientConnection,
  sessionId: string,
): Promise<AcpTurnStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      connection.agent.request(RUN_RESULT_METHOD, { sessionId }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("stall probe timed out")),
          STALL_PROBE_RPC_TIMEOUT_MS,
        );
      }),
    ]);
    const parsed = platformRunResultResponseSchema.safeParse(raw);
    if (!parsed.success) return "unknown";
    if (parsed.data.status === "pending") return "pending";
    if (parsed.data.status === "interrupted") return "interrupted";
    return "ended";
  } catch {
    return "unknown";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface ClientHandlers {
  requestPermission: (
    params: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>;
  sessionUpdate?: (params: SessionNotification) => Promise<void>;
}

function connectClient(
  stream: Stream,
  handlers: ClientHandlers,
): ClientConnection {
  return client()
    .onRequest("session/request_permission", (ctx) =>
      handlers.requestPermission(ctx.params),
    )
    .onNotification("session/update", async (ctx) => {
      await handlers.sessionUpdate?.(ctx.params);
    })
    .onRequest("fs/write_text_file", () => ({}))
    .onRequest("fs/read_text_file", () => ({ content: "" }))
    .connect(stream);
}

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.on("message", (data) =>
            controller.enqueue(JSON.parse(data.toString())),
          );
          ws.on("close", () => {
            try {
              controller.close();
            } catch {}
          });
          ws.on("error", (err) => {
            try {
              controller.error(err);
            } catch {}
          });
        },
      });
      const writable = new WritableStream<AnyMessage>({
        write(chunk) {
          ws.send(JSON.stringify(chunk));
        },
        close() {
          ws.close();
        },
      });
      resolve({ stream: { readable, writable }, ws });
    });
    ws.on("error", reject);
  });
}

export interface PlatformSessionMeta {
  mode?: string;
  type?: string;
  scheduleId?: string;
  experimentId?: string;
  initialization?: boolean;
  threadTs?: string;
  createdAt?: string;
}

export interface AcpSessionInfo {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
  platform?: PlatformSessionMeta | null;
}

const platformSessionMetaSchema = z.object({
  mode: z.string().optional(),
  type: z.string().optional(),
  scheduleId: z.string().optional(),
  experimentId: z.string().optional(),
  initialization: z.boolean().optional(),
  threadTs: z.string().optional(),
  createdAt: z.string().optional(),
});

export interface TriggerSessionResult {
  sessionId: string;
  stopReason?: string;
}

export type SteerOutcome =
  "injected" | "no-running-turn" | "unsupported" | "failed";

const steerResponseSchema = z.object({
  outcome: z.string().optional(),
});

function steeringSupported(init: InitializeResponse): boolean {
  const meta = (init as { _meta?: unknown })._meta;
  if (typeof meta !== "object" || meta === null) return false;
  const steering = (meta as { steering?: unknown }).steering;
  if (typeof steering !== "object" || steering === null) return false;
  return (steering as { supported?: unknown }).supported === true;
}

type SessionAttach =
  | { resumeSessionId: string }
  | { onSessionCreated: (sessionId: string) => Promise<void> };

export type PromptUpdate =
  | { kind: "text"; text: string }
  | { kind: "thought" }
  | { kind: "tool"; title: string | null };

export function toPromptUpdate(update: unknown): PromptUpdate | null {
  const u = update as
    | {
        sessionUpdate?: string;
        title?: unknown;
        content?: { type?: string; text?: string };
      }
    | undefined;
  switch (u?.sessionUpdate) {
    case "agent_message_chunk":
      return u.content?.type === "text" && typeof u.content.text === "string"
        ? { kind: "text", text: u.content.text }
        : null;
    case "agent_thought_chunk":
      return { kind: "thought" };
    case "tool_call":
      return {
        kind: "tool",
        title: typeof u.title === "string" ? u.title : null,
      };
    case "tool_call_update":
      return typeof u.title === "string"
        ? { kind: "tool", title: u.title }
        : null;
    default:
      return null;
  }
}

export type SendPromptOpts = (
  { resumeSessionId: string } | { platformMeta?: PlatformSessionMeta }
) & {
  onImagesDropped?: () => Promise<void> | void;
  onUpdate?: (update: PromptUpdate) => void;
  onSession?: (sessionId: string) => void;
};

export type TriggerSessionOpts = {
  prompt: string;
  mcpServers?: unknown[];
} & SessionAttach;

export type AcpTurnStatus = "pending" | "ended" | "interrupted" | "unknown";

export interface AcpClient {
  listSessions(): Promise<AcpSessionInfo[]>;
  sendPrompt(
    prompt: string | ContentBlock[],
    opts: SendPromptOpts,
  ): Promise<string>;
  steer(
    sessionId: string,
    prompt: string | ContentBlock[],
  ): Promise<SteerOutcome>;
  triggerSession(opts: TriggerSessionOpts): Promise<TriggerSessionResult>;
  turnStatus(sessionId: string): Promise<AcpTurnStatus>;
}

function isRefusal(kind: AcpPermissionOption["kind"]): boolean {
  return match(kind)
    .with("reject_once", "reject_always", () => true)
    .with("allow_once", "allow_always", undefined, () => false)
    .exhaustive();
}

function rejectOptionId(
  options: readonly AcpPermissionOption[],
): string | null {
  const preferred = options.find((option) => option.kind === "reject_once");
  const refusal = preferred ?? options.find((option) => isRefusal(option.kind));
  return refusal?.optionId ?? null;
}

function allowOnceOptionId(
  options: readonly AcpPermissionOption[],
): string | null {
  const once = options.find((option) => option.kind === "allow_once");
  return once?.optionId ?? null;
}

function permissionToolName(toolCall: unknown): string | null {
  if (!toolCall || typeof toolCall !== "object") return null;
  const { name } = toolCall as { name?: unknown };
  return typeof name === "string" && name !== "" ? name : null;
}

function permissionToolLabel(toolCall: unknown): string | null {
  if (!toolCall || typeof toolCall !== "object") return null;
  const { title } = toolCall as { title?: unknown };
  const named = permissionToolName(toolCall);
  if (named) return named;
  return typeof title === "string" && title !== "" ? title : null;
}

async function withAcpConnection<T>(
  url: string,
  agentId: string,
  clientName: string,
  handlers: { sessionUpdate?: (params: SessionNotification) => Promise<void> },
  watch: ConnectionWatch,
  fn: (connection: ClientConnection, init: InitializeResponse) => Promise<T>,
): Promise<T> {
  const { stream, ws } = await wsStream(url);

  const ac = new AbortController();
  let abortError: Error = new AcpTurnAbandonedError(
    "connection-lost",
    "ACP connection aborted",
  );
  const abortWith = (err: Error) => {
    abortError = err;
    ac.abort();
  };

  let missedPongs = 0;
  ws.on("pong", () => {
    missedPongs = 0;
  });
  const heartbeat = setInterval(() => {
    if (missedPongs >= MAX_MISSED_PONGS) {
      abortWith(
        new AcpTurnAbandonedError(
          "connection-lost",
          "ACP connection lost (agent unreachable)",
        ),
      );
      return;
    }
    missedPongs += 1;
    try {
      ws.ping();
    } catch (err) {
      getLogger().debug({ err, clientName }, "acp heartbeat ping failed");
    }
  }, PING_INTERVAL_MS);

  let lastFrameAt = Date.now();
  ws.on("message", () => {
    lastFrameAt = Date.now();
  });

  const connection = connectClient(stream, {
    async requestPermission(params) {
      const toolName = permissionToolLabel(params.toolCall);
      const sessionId = params.sessionId ?? null;
      const allowId = isPlatformMcpTool(permissionToolName(params.toolCall))
        ? allowOnceOptionId(params.options ?? [])
        : null;
      if (allowId) {
        securityLog("info", "approval.platform_tool_allow", {
          category: "approval",
          actor: null,
          actorKind: "agent",
          agentId,
          decision: "allow",
          reason: "platform-mcp-surface",
          detail: { toolName, sessionId },
        });
        return {
          outcome: { outcome: "selected" as const, optionId: allowId },
        };
      }
      const optionId = rejectOptionId(params.options ?? []);
      securityLog("warn", "approval.unattended_deny", {
        category: "approval",
        actor: null,
        actorKind: "agent",
        agentId,
        decision: "deny",
        reason: "unattended-channel-turn",
        detail: { toolName, sessionId },
      });
      return optionId
        ? { outcome: { outcome: "selected" as const, optionId } }
        : { outcome: { outcome: "cancelled" as const } };
    },
    sessionUpdate: handlers.sessionUpdate,
  });

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let probeTimer: ReturnType<typeof setInterval> | undefined;

  if (watch.kind === "deadline") {
    deadlineTimer = setTimeout(() => {
      abortWith(
        new Error(
          `ACP call exceeded its ${Math.round(watch.ms / 1000)}s deadline`,
        ),
      );
    }, watch.ms);
  } else {
    let probing = false;
    probeTimer = setInterval(() => {
      if (probing) return;
      if (Date.now() - lastFrameAt < watch.stallProbeMs) return;
      const sessionId = watch.sessionId();
      if (sessionId === null) return;
      probing = true;
      void probeTurnStatus(connection, sessionId)
        .then((verdict) => {
          if (verdict === "pending") {
            lastFrameAt = Date.now();
          } else if (verdict !== "unknown") {
            abortWith(
              new AcpTurnAbandonedError(
                "stalled",
                "ACP turn went silent and the agent reports it is no longer running",
              ),
            );
          }
        })
        .finally(() => {
          probing = false;
        });
    }, watch.stallProbeMs);
  }

  const cleanup = () => {
    clearInterval(heartbeat);
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (probeTimer !== undefined) clearInterval(probeTimer);
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
      ws.close();
  };

  try {
    const init = await connection.agent.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: clientName, version: "1.0.0" },
    });
    const result = await Promise.race([
      fn(connection, init),
      new Promise<never>((_, reject) => {
        if (ac.signal.aborted) {
          reject(abortError);
          return;
        }
        ac.signal.addEventListener("abort", () => reject(abortError), {
          once: true,
        });
      }),
    ]);
    return result;
  } finally {
    cleanup();
  }
}

export type AcpClientFactory = (instanceName: string) => AcpClient;

export function createAcpClient(opts: {
  namespace: string;
  instanceName: string;
  stallProbeMs: number;
}): AcpClient {
  const url = `ws://${podBaseUrl(opts.instanceName, opts.namespace)}/api/acp`;
  const { instanceName: agentId, stallProbeMs } = opts;
  return {
    async listSessions(): Promise<AcpSessionInfo[]> {
      const { stream, ws } = await wsStream(url);

      const connection = connectClient(stream, {
        async requestPermission() {
          return { outcome: { outcome: "cancelled" as const } };
        },
      });

      try {
        await connection.agent.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "platform-sessions", version: "1.0.0" },
        });
        const r = await connection.agent.request("session/list", { cwd: "." });
        return (r.sessions ?? []).map((s: any): AcpSessionInfo => {
          const parsed = platformSessionMetaSchema.safeParse(
            s?._meta?.platform,
          );
          return {
            sessionId: s.sessionId,
            title: s.title ?? null,
            updatedAt: s.updatedAt ?? null,
            platform: parsed.success ? parsed.data : null,
          };
        });
      } finally {
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
      }
    },

    async sendPrompt(
      prompt: string | ContentBlock[],
      sendOpts: SendPromptOpts,
    ): Promise<string> {
      const responseChunks: string[] = [];
      let live = false;
      let watchSessionId: string | null = null;

      await withAcpConnection(
        url,
        agentId,
        "platform-acp",
        {
          async sessionUpdate(params: any) {
            if (
              params.update?.sessionUpdate === "agent_message_chunk" &&
              params.update.content?.type === "text"
            ) {
              responseChunks.push(params.update.content.text);
            }
            if (live && sendOpts.onUpdate) {
              const update = toPromptUpdate(params.update);
              if (update) {
                try {
                  sendOpts.onUpdate(update);
                } catch (err) {
                  getLogger().debug(
                    { err },
                    "acp onUpdate callback failed; ignoring",
                  );
                }
              }
            }
          },
        },
        {
          kind: "turn",
          stallProbeMs,
          sessionId: () => watchSessionId,
        },
        async (connection, init) => {
          let sessionId: string;
          if ("resumeSessionId" in sendOpts) {
            try {
              await connection.agent.request("session/load", {
                sessionId: sendOpts.resumeSessionId,
                cwd: ".",
                mcpServers: [],
              });
            } catch (err) {
              throw new AcpSessionLoadError(
                `failed to load session ${sendOpts.resumeSessionId}`,
                { cause: err },
              );
            }
            responseChunks.length = 0;
            sessionId = sendOpts.resumeSessionId;
            watchSessionId = sessionId;
          } else {
            const newSession: NewSessionRequest = {
              cwd: ".",
              mcpServers: [],
              ...(sendOpts.platformMeta && {
                _meta: { platform: sendOpts.platformMeta },
              }),
            };
            const s = await connection.agent.request("session/new", newSession);
            sessionId = s.sessionId;
            watchSessionId = sessionId;
          }
          try {
            sendOpts.onSession?.(sessionId);
          } catch (err) {
            getLogger().debug(
              { err },
              "acp onSession callback failed; ignoring",
            );
          }

          const blocks: ContentBlock[] =
            typeof prompt === "string"
              ? [{ type: "text", text: prompt }]
              : prompt;
          const supportsImages =
            init.agentCapabilities?.promptCapabilities?.image === true;
          const hasImages = blocks.some((b) => b.type === "image");
          const finalBlocks =
            hasImages && !supportsImages
              ? blocks.filter((b) => b.type !== "image")
              : blocks;
          if (hasImages && !supportsImages) {
            await sendOpts.onImagesDropped?.();
          }

          live = true;
          await connection.agent.request("session/prompt", {
            sessionId,
            prompt: finalBlocks,
          });
        },
      );

      return responseChunks.join("");
    },

    async steer(
      sessionId: string,
      prompt: string | ContentBlock[],
    ): Promise<SteerOutcome> {
      const blocks: ContentBlock[] =
        typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;
      try {
        return await withAcpConnection(
          url,
          agentId,
          "platform-steer",
          {},
          { kind: "deadline", ms: STEER_CEILING_MS },
          async (connection, init) => {
            if (!steeringSupported(init)) return "unsupported";
            const raw = await connection.agent.request(STEER_METHOD, {
              sessionId,
              prompt: blocks,
              _meta: { steering: { idleBehavior: "promptRequired" } },
            });
            const parsed = steerResponseSchema.safeParse(raw);
            const outcome = parsed.success ? parsed.data.outcome : undefined;
            if (outcome === "injected") return "injected";
            if (outcome === "promptRequired") return "no-running-turn";
            return "failed";
          },
        );
      } catch (err) {
        getLogger().debug({ err, sessionId }, "acp steer failed");
        return "failed";
      }
    },

    async turnStatus(sessionId: string): Promise<AcpTurnStatus> {
      return withAcpConnection(
        url,
        agentId,
        "platform-turn-status",
        {},
        { kind: "deadline", ms: TURN_STATUS_DEADLINE_MS },
        (connection) => probeTurnStatus(connection, sessionId),
      );
    },

    async triggerSession(
      triggerOpts: TriggerSessionOpts,
    ): Promise<TriggerSessionResult> {
      let watchSessionId: string | null = null;
      return withAcpConnection(
        url,
        agentId,
        "platform-trigger",
        {},
        {
          kind: "turn",
          stallProbeMs,
          sessionId: () => watchSessionId,
        },
        async (connection, _init) => {
          let sessionId: string;
          const mcpServers = (triggerOpts.mcpServers ?? []) as McpServer[];

          if ("resumeSessionId" in triggerOpts) {
            try {
              await connection.agent.request("session/resume", {
                sessionId: triggerOpts.resumeSessionId,
                cwd: ".",
                mcpServers,
              });
            } catch (err) {
              throw new AcpSessionLoadError(
                `failed to resume session ${triggerOpts.resumeSessionId}`,
                { cause: err },
              );
            }
            sessionId = triggerOpts.resumeSessionId;
            watchSessionId = sessionId;
          } else {
            const s = await connection.agent.request("session/new", {
              cwd: ".",
              mcpServers,
            });
            sessionId = s.sessionId;
            watchSessionId = sessionId;
            await triggerOpts.onSessionCreated(sessionId);
          }

          const r = await connection.agent.request("session/prompt", {
            sessionId,
            prompt: [{ type: "text", text: triggerOpts.prompt }],
          });

          return { sessionId, stopReason: r.stopReason };
        },
      );
    },
  };
}
