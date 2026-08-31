import { WebSocket } from "ws";
import { z } from "zod";
import { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type {
  ContentBlock,
  InitializeResponse,
} from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { podBaseUrl } from "../modules/agents/infrastructure/k8s.js";
import { getLogger } from "./logger.js";

const PING_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 2;
const DEFAULT_TURN_CEILING_MS = 60 * 60 * 1000;

const STEER_METHOD = "_session/steering";
const STEER_CEILING_MS = 30_000;

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
  threadTs: z.string().optional(),
  createdAt: z.string().optional(),
});

export interface TriggerSessionResult {
  sessionId: string;
  stopReason?: string;
}

export type SteerOutcome =
  | "injected"
  | "no-running-turn"
  | "unsupported"
  | "failed";

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
  | { resumeSessionId: string }
  | { platformMeta?: PlatformSessionMeta }
) & {
  onImagesDropped?: () => Promise<void> | void;
  onUpdate?: (update: PromptUpdate) => void;
  onSession?: (sessionId: string) => void;
};

export type TriggerSessionOpts = {
  prompt: string;
  mcpServers?: unknown[];
} & SessionAttach;

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
}

async function withAcpConnection<T>(
  url: string,
  clientName: string,
  handlers: { sessionUpdate?: (params: any) => Promise<void> },
  turnCeilingMs: number,
  fn: (
    connection: ClientSideConnection,
    init: InitializeResponse,
  ) => Promise<T>,
): Promise<T> {
  const { stream, ws } = await wsStream(url);

  const ac = new AbortController();
  let abortReason = "ACP connection aborted";

  let missedPongs = 0;
  ws.on("pong", () => {
    missedPongs = 0;
  });
  const heartbeat = setInterval(() => {
    if (missedPongs >= MAX_MISSED_PONGS) {
      abortReason = "ACP connection lost (agent unreachable)";
      ac.abort();
      return;
    }
    missedPongs += 1;
    try {
      ws.ping();
    } catch (err) {
      getLogger().debug({ err, clientName }, "acp heartbeat ping failed");
    }
  }, PING_INTERVAL_MS);

  const ceiling = setTimeout(() => {
    abortReason = `ACP turn exceeded the ${Math.round(turnCeilingMs / 1000)}s ceiling`;
    ac.abort();
  }, turnCeilingMs);

  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params: any) {
        return {
          outcome: {
            outcome: "selected" as const,
            optionId: params.options[0].optionId,
          },
        };
      },
      async sessionUpdate(params: any) {
        await handlers.sessionUpdate?.(params);
      },
      async writeTextFile() {
        return {};
      },
      async readTextFile() {
        return { content: "" };
      },
      async extNotification() {},
    }),
    stream,
  );

  const cleanup = () => {
    clearInterval(heartbeat);
    clearTimeout(ceiling);
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
      ws.close();
  };

  try {
    const init = await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: clientName, version: "1.0.0" },
    });
    return await Promise.race([
      fn(connection, init),
      new Promise<never>((_, reject) => {
        if (ac.signal.aborted) {
          reject(new Error(abortReason));
          return;
        }
        ac.signal.addEventListener(
          "abort",
          () => reject(new Error(abortReason)),
          { once: true },
        );
      }),
    ]);
  } finally {
    cleanup();
  }
}

export type AcpClientFactory = (instanceName: string) => AcpClient;

export function createAcpClient(opts: {
  namespace: string;
  instanceName: string;
  turnCeilingMs?: number;
}): AcpClient {
  return createAcpClientForUrl(
    `ws://${podBaseUrl(opts.instanceName, opts.namespace)}/api/acp`,
    opts.turnCeilingMs ?? DEFAULT_TURN_CEILING_MS,
  );
}

function createAcpClientForUrl(url: string, turnCeilingMs: number): AcpClient {
  return {
    async listSessions(): Promise<AcpSessionInfo[]> {
      const { stream, ws } = await wsStream(url);

      const connection = new ClientSideConnection(
        () => ({
          async requestPermission() {
            return { outcome: { outcome: "selected" as const, optionId: "" } };
          },
          async sessionUpdate() {},
          async writeTextFile() {
            return {};
          },
          async readTextFile() {
            return { content: "" };
          },
          async extNotification() {},
        }),
        stream,
      );

      try {
        await connection.initialize({
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "platform-sessions", version: "1.0.0" },
        });
        const r = await connection.listSessions({ cwd: "." });
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

      await withAcpConnection(
        url,
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
        turnCeilingMs,
        async (connection, init) => {
          let sessionId: string;
          if ("resumeSessionId" in sendOpts) {
            await connection.loadSession({
              sessionId: sendOpts.resumeSessionId,
              cwd: ".",
              mcpServers: [],
            });
            responseChunks.length = 0;
            sessionId = sendOpts.resumeSessionId;
          } else {
            const s = await connection.newSession({
              cwd: ".",
              mcpServers: [],
              ...(sendOpts.platformMeta && {
                _meta: { platform: sendOpts.platformMeta },
              }),
            } as Parameters<typeof connection.newSession>[0]);
            sessionId = s.sessionId;
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
          await connection.prompt({ sessionId, prompt: finalBlocks });
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
          "platform-steer",
          {},
          STEER_CEILING_MS,
          async (connection, init) => {
            if (!steeringSupported(init)) return "unsupported";
            const raw = await connection.extMethod(STEER_METHOD, {
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

    async triggerSession(
      triggerOpts: TriggerSessionOpts,
    ): Promise<TriggerSessionResult> {
      return withAcpConnection(
        url,
        "platform-trigger",
        {},
        turnCeilingMs,
        async (connection, _init) => {
          let sessionId: string;
          const mcpServers = (triggerOpts.mcpServers ?? []) as any[];

          if ("resumeSessionId" in triggerOpts) {
            await connection.unstable_resumeSession({
              sessionId: triggerOpts.resumeSessionId,
              cwd: ".",
              mcpServers,
            });
            sessionId = triggerOpts.resumeSessionId;
          } else {
            const s = await connection.newSession({ cwd: ".", mcpServers });
            sessionId = s.sessionId;
            await triggerOpts.onSessionCreated(sessionId);
          }

          const r = await connection.prompt({
            sessionId,
            prompt: [{ type: "text", text: triggerOpts.prompt }],
          });

          return { sessionId, stopReason: r.stopReason };
        },
      );
    },
  };
}
