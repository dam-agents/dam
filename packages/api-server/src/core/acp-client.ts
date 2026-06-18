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

const TIMEOUT_MS = 120_000;

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

/** Resume an existing session, or start a new one stamping `_meta.platform`
 *  so the agent records it — no server-side persist needed. */
export type SendPromptOpts = (
  | { resumeSessionId: string }
  | { platformMeta?: PlatformSessionMeta }
) & {
  /** Called when image blocks are stripped because the agent lacks image support. */
  onImagesDropped?: () => Promise<void> | void;
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
  fn: (
    connection: ClientSideConnection,
    init: InitializeResponse,
  ) => Promise<T>,
): Promise<T> {
  const { stream, ws } = await wsStream(url);

  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  };

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
        resetTimeout();
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
    clearTimeout(timer);
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
      ws.close();
  };

  try {
    ac.signal.addEventListener("abort", cleanup, { once: true });
    const init = await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: clientName, version: "1.0.0" },
    });
    return await Promise.race([
      fn(connection, init),
      new Promise<never>((_, reject) => {
        if (ac.signal.aborted) {
          reject(
            new Error(
              `ACP connection timed out after ${TIMEOUT_MS / 1000}s of inactivity`,
            ),
          );
          return;
        }
        ac.signal.addEventListener(
          "abort",
          () =>
            reject(
              new Error(
                `ACP connection timed out after ${TIMEOUT_MS / 1000}s of inactivity`,
              ),
            ),
          { once: true },
        );
      }),
    ]);
  } finally {
    ac.signal.removeEventListener("abort", cleanup);
    cleanup();
  }
}

export function createAcpClient(opts: {
  namespace: string;
  instanceName: string;
}): AcpClient {
  return createAcpClientForUrl(
    `ws://${podBaseUrl(opts.instanceName, opts.namespace)}/api/acp`,
  );
}

export function createForkAcpClient(opts: { podIP: string }): AcpClient {
  return createAcpClientForUrl(`ws://${opts.podIP}:8080/api/acp`);
}

function createAcpClientForUrl(url: string): AcpClient {
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
          },
        },
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
