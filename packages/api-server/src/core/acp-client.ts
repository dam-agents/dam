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

/** How often we ping the agent-runtime ws to prove the socket is alive.
 *  Mirrors the ssh-relay heartbeat. */
const PING_INTERVAL_MS = 30_000;
/** Consecutive unanswered pings before the socket is declared dead. A single
 *  GC pause or event-loop stall on a healthy agent-runtime can delay one pong
 *  past a 30s tick; requiring two misses (~90s of silence) rides that out
 *  without killing a live turn, while still catching a real half-open socket
 *  far inside the turn ceiling. */
const MAX_MISSED_PONGS = 2;
/** Fallback per-turn ceiling when a caller doesn't supply one (tests, direct
 *  use). Production wires config.acpTurnCeilingSeconds through the factories. */
const DEFAULT_TURN_CEILING_MS = 60 * 60 * 1000;

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
  /** Platform metadata round-tripped via `_meta.platform`; null for
   * harness-internally-minted sessions (e.g. TUI `/clear`). */
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

/** How a call binds to its session: resume an existing one, or create a new
 *  one and persist it via the callback. Mutually exclusive by construction. */
type SessionAttach =
  | { resumeSessionId: string }
  | { onSessionCreated: (sessionId: string) => Promise<void> };

/** Live progress of a running turn, projected onto the narrow surface channel
 *  workers consume. Tool updates carry the human-readable title only. */
export type PromptUpdate =
  | { kind: "text"; text: string }
  | { kind: "thought" }
  | { kind: "tool"; title: string | null };

/** Projects a raw ACP `session/update` notification onto {@link PromptUpdate}.
 *  Returns null for updates consumers don't care about (plans, mode changes,
 *  user-message echoes, title-less tool patches). */
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
      // Status-only patches would spam consumers; only a title change matters.
      return typeof u.title === "string"
        ? { kind: "tool", title: u.title }
        : null;
    default:
      return null;
  }
}

/** Resume an existing session, or start a new one stamping `_meta.platform`
 *  so the agent records it — no server-side persist needed. */
export type SendPromptOpts = (
  | { resumeSessionId: string }
  | { platformMeta?: PlatformSessionMeta }
) & {
  /** Called when image blocks are stripped because the agent lacks image support. */
  onImagesDropped?: () => Promise<void> | void;
  /** Live per-notification progress for this turn only — resume replays of
   *  prior history are withheld. Must not throw; failures are swallowed. */
  onUpdate?: (update: PromptUpdate) => void;
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

  // Liveness is a transport signal, not an application one. The agent-runtime's
  // ws server auto-pongs, so a live-but-silent turn — an egress approval hold, a
  // long tool, a slow first token — stays connected; only a dead/half-open
  // socket aborts. Mirrors the ssh-relay heartbeat. A pong resets the miss
  // counter; MAX_MISSED_PONGS consecutive unanswered pings aborts.
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
      // A throw here means the socket is already broken; the next tick will
      // trip the miss ceiling and abort. Log so a real transport failure
      // isn't invisible.
      getLogger().debug({ err, clientName }, "acp heartbeat ping failed");
    }
  }, PING_INTERVAL_MS);

  // Absolute backstop against a wedged-but-still-ponging agent. Sized at/above
  // the egress approval hold (config enforces acpTurnCeilingSeconds >=
  // approvalHoldSeconds) so a human taking the full approval window never trips it.
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
      // On abort the race settles here regardless of whether fn is hung, so the
      // finally block runs promptly; no separate abort→cleanup listener needed.
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

/** Builds an AcpClient for a resolved agent instance. Bound at the composition
 *  root with the turn ceiling baked in, then injected into the channel workers. */
export type AcpClientFactory = (instanceName: string) => AcpClient;
/** Builds an AcpClient for a fork pod addressed by IP. */
export type ForkAcpClientFactory = (podIP: string) => AcpClient;

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

export function createForkAcpClient(opts: {
  podIP: string;
  turnCeilingMs?: number;
}): AcpClient {
  return createAcpClientForUrl(
    `ws://${opts.podIP}:8080/api/acp`,
    opts.turnCeilingMs ?? DEFAULT_TURN_CEILING_MS,
  );
}

function createAcpClientForUrl(url: string, turnCeilingMs: number): AcpClient {
  return {
    // Throws on connection/RPC failure; callers (the repository and the
    // channel workers) catch and treat an unreachable agent as "no sessions".
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
      // loadSession replays prior history as ordinary notifications before the
      // live turn starts; hold the caller's onUpdate until the prompt is sent.
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
            // loadSession (not unstable_resumeSession) survives the agent-runtime's
            // idle reap — the runtime replays history from its log or cold-bootstraps
            // the session in the agent subprocess.
            await connection.loadSession({
              sessionId: sendOpts.resumeSessionId,
              cwd: ".",
              mcpServers: [],
            });
            // History replay arrives as agent_message_chunk notifications; drop them
            // so the caller only sees this turn's response.
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

          // Everything before this point is setup/replay; from here on the
          // notifications belong to this turn, so start forwarding them.
          live = true;
          await connection.prompt({ sessionId, prompt: finalBlocks });
        },
      );

      return responseChunks.join("");
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
