import { WebSocket } from "ws";
import { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import { podBaseUrl } from "../modules/agents/infrastructure/k8s.js";

const TIMEOUT_MS = 120_000;

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.on("message", (data) => controller.enqueue(JSON.parse(data.toString())));
          ws.on("close", () => {
            try { controller.close(); } catch {}
          });
          ws.on("error", (err) => {
            try { controller.error(err); } catch {}
          });
        },
      });
      const writable = new WritableStream<AnyMessage>({
        write(chunk) { ws.send(JSON.stringify(chunk)); },
        close() { ws.close(); },
      });
      resolve({ stream: { readable, writable }, ws });
    });
    ws.on("error", reject);
  });
}

export interface AcpSessionInfo {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface TriggerSessionResult {
  sessionId: string;
  stopReason?: string;
}

export interface AcpClient {
  listSessions(): Promise<AcpSessionInfo[]>;
  sendPrompt(prompt: string, opts?: { resumeSessionId?: string }): Promise<string>;
  triggerSession(opts: {
    prompt: string;
    resumeSessionId?: string;
    mcpServers?: unknown[];
  }): Promise<TriggerSessionResult>;
}

async function withAcpConnection<T>(
  url: string,
  clientName: string,
  handlers: { sessionUpdate?: (params: any) => Promise<void> },
  fn: (connection: ClientSideConnection) => Promise<T>,
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
        return { outcome: { outcome: "selected" as const, optionId: params.options[0].optionId } };
      },
      async sessionUpdate(params: any) {
        resetTimeout();
        await handlers.sessionUpdate?.(params);
      },
      async writeTextFile() { return {}; },
      async readTextFile() { return { content: "" }; },
      async extNotification() {},
    }),
    stream,
  );

  const cleanup = () => {
    clearTimeout(timer);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  try {
    ac.signal.addEventListener("abort", cleanup, { once: true });
    await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: clientName, version: "1.0.0" },
    });
    return await Promise.race([
      fn(connection),
      new Promise<never>((_, reject) => {
        if (ac.signal.aborted) {
          reject(new Error(`ACP connection timed out after ${TIMEOUT_MS / 1000}s of inactivity`));
          return;
        }
        ac.signal.addEventListener(
          "abort",
          () => reject(new Error(`ACP connection timed out after ${TIMEOUT_MS / 1000}s of inactivity`)),
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
  onSessionCreated: (sessionId: string) => Promise<void>;
}): AcpClient {
  return createAcpClientForUrl({
    url: `ws://${podBaseUrl(opts.instanceName, opts.namespace)}/api/acp`,
    onSessionCreated: opts.onSessionCreated,
  });
}

export function createForkAcpClient(opts: {
  podIP: string;
  onSessionCreated: (sessionId: string) => Promise<void>;
}): AcpClient {
  return createAcpClientForUrl({
    url: `ws://${opts.podIP}:8080/api/acp`,
    onSessionCreated: opts.onSessionCreated,
  });
}

function createAcpClientForUrl(opts: {
  url: string;
  onSessionCreated: (sessionId: string) => Promise<void>;
}): AcpClient {
  const { url } = opts;

  return {
    async listSessions(): Promise<AcpSessionInfo[]> {
      let stream: Stream;
      let ws: WebSocket;
      try {
        ({ stream, ws } = await wsStream(url));
      } catch {
        return [];
      }

      const connection = new ClientSideConnection(
        () => ({
          async requestPermission() { return { outcome: { outcome: "selected" as const, optionId: "" } }; },
          async sessionUpdate() {},
          async writeTextFile() { return {}; },
          async readTextFile() { return { content: "" }; },
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
        return (r.sessions ?? []) as AcpSessionInfo[];
      } catch {
        return [];
      } finally {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
    },

    async sendPrompt(prompt: string, sendOpts?: { resumeSessionId?: string }): Promise<string> {
      const responseChunks: string[] = [];

      await withAcpConnection(url, "platform-acp", {
        async sessionUpdate(params: any) {
          if (params.update?.sessionUpdate === "agent_message_chunk" && params.update.content?.type === "text") {
            responseChunks.push(params.update.content.text);
          }
        },
      }, async (connection) => {
        let sessionId: string;
        if (sendOpts?.resumeSessionId) {
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
          const s = await connection.newSession({ cwd: ".", mcpServers: [] });
          sessionId = s.sessionId;
          await opts.onSessionCreated(sessionId);
        }
        await connection.prompt({ sessionId, prompt: [{ type: "text", text: prompt }] });
      });

      return responseChunks.join("");
    },

    async triggerSession(triggerOpts: {
      prompt: string;
      resumeSessionId?: string;
      mcpServers?: unknown[];
    }): Promise<TriggerSessionResult> {
      return withAcpConnection(url, "platform-trigger", {}, async (connection) => {
        let sessionId: string;
        const mcpServers = (triggerOpts.mcpServers ?? []) as any[];

        if (triggerOpts.resumeSessionId) {
          await connection.unstable_resumeSession({
            sessionId: triggerOpts.resumeSessionId,
            cwd: ".",
            mcpServers,
          });
          sessionId = triggerOpts.resumeSessionId;
        } else {
          const s = await connection.newSession({ cwd: ".", mcpServers });
          sessionId = s.sessionId;
          await opts.onSessionCreated(sessionId);
        }

        const r = await connection.prompt({
          sessionId,
          prompt: [{ type: "text", text: triggerOpts.prompt }],
        });

        return { sessionId, stopReason: r.stopReason };
      });
    },
  };
}
