import { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { WebSocket } from "ws";

import { proxyAgentForUrl } from "../../shared/ws-proxy.js";

const TIMEOUT_MS = 120_000;

interface PlatformMeta {
  mode?: string;
  type?: string;
  scheduleId?: string;
  experimentId?: string;
  threadTs?: string;
  createdAt?: string;
  running?: boolean;
  seenAt?: string;
  runStartedAt?: string;
  runTotalMs?: number;
  runCount?: number;
}

interface ListedSession {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
  _meta?: { platform?: PlatformMeta };
}

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { agent: proxyAgentForUrl(url) });
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
          ws.on("error", (e) => {
            try {
              controller.error(e);
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

function acpUrl(host: string, agentId: string, token: string): string {
  const proto = host.startsWith("https://") ? "wss:" : "ws:";
  const base = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${proto}//${base}/api/agents/${encodeURIComponent(agentId)}/acp?token=${encodeURIComponent(token)}`;
}

function toSessionView(agentId: string, s: ListedSession): SessionView {
  const p = s._meta?.platform;
  return {
    sessionId: s.sessionId,
    agentId,
    type: (p?.type as SessionType) ?? SessionType.Regular,
    mode: p
      ? ((p.mode as SessionMode) ?? SessionMode.Chat)
      : SessionMode.Terminal,
    createdAt: p?.createdAt ?? s.updatedAt ?? new Date(0).toISOString(),
    scheduleId: p?.scheduleId ?? null,
    experimentId: p?.experimentId ?? null,
    threadTs: p?.threadTs ?? null,
    title: s.title ?? null,
    updatedAt: s.updatedAt ?? null,
    running: p?.running ?? false,
    seenAt: p?.seenAt ?? null,
    runStartedAt: p?.runStartedAt ?? null,
    runTotalMs: p?.runTotalMs ?? null,
    runCount: p?.runCount ?? null,
  };
}

async function withConnection<T>(
  url: string,
  fn: (conn: ClientSideConnection) => Promise<T>,
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
      requestPermission() {
        return new Promise<never>(() => {});
      },
      async sessionUpdate() {
        resetTimeout();
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
    await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "platform-cli-sessions", version: "1.0.0" },
    });
    return await Promise.race([
      fn(connection),
      new Promise<never>((_, reject) => {
        const fail = () =>
          reject(
            new Error(
              `ACP connection timed out after ${TIMEOUT_MS / 1000}s of inactivity`,
            ),
          );
        if (ac.signal.aborted) fail();
        else ac.signal.addEventListener("abort", fail, { once: true });
      }),
    ]);
  } finally {
    ac.signal.removeEventListener("abort", cleanup);
    cleanup();
  }
}

export interface AcpSessionClient {
  list(agentId: string): Promise<SessionView[]>;
  setMode(agentId: string, sessionId: string, mode: SessionMode): Promise<void>;
}

export function createAcpSessionClient(opts: {
  host: string;
  token: string;
}): AcpSessionClient {
  return {
    async list(agentId) {
      return withConnection(
        acpUrl(opts.host, agentId, opts.token),
        async (conn) => {
          const r = await conn.listSessions({ cwd: "." });
          return (r.sessions ?? []).map((s) =>
            toSessionView(agentId, s as unknown as ListedSession),
          );
        },
      );
    },
    async setMode(agentId, sessionId, mode) {
      await withConnection(acpUrl(opts.host, agentId, opts.token), (conn) =>
        conn.unstable_resumeSession({
          sessionId,
          cwd: ".",
          mcpServers: [],
          _meta: { platform: { mode } },
        }),
      );
    },
  };
}
