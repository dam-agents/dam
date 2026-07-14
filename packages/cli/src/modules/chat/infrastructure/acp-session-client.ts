import { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { WebSocket } from "ws";

import { proxyAgentForUrl } from "../../shared/ws-proxy.js";

/**
 * Sessions are agent-owned: there is no server session store. The CLI
 * reads and mutates them directly over the api-server's ACP relay WebSocket,
 * exactly like the UI and channel workers — listing decodes `_meta.platform`,
 * and a mode change rides `session/resume` with `_meta.platform.mode`.
 */

const TIMEOUT_MS = 120_000;

interface PlatformMeta {
  mode?: string;
  type?: string;
  scheduleId?: string;
  experimentId?: string;
  threadTs?: string;
  createdAt?: string;
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

/** Decode an ACP-listed session into a SessionView: no `_meta.platform`
 *  marks a harness-minted session (e.g. terminal/`/clear`) and defaults to
 *  terminal; an ACP-created session carries a (possibly empty) entry and
 *  defaults to chat. */
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
    title: s.title ?? null,
    updatedAt: s.updatedAt ?? null,
  };
}

async function withConnection<T>(
  url: string,
  fn: (conn: ClientSideConnection) => Promise<T>,
): Promise<T> {
  const { stream, ws } = await wsStream(url);

  // A relay that accepts the socket but whose agent never answers would hang
  // the CLI forever; abort after TIMEOUT_MS of inactivity (cf. api-server).
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  };

  const connection = new ClientSideConnection(
    () => ({
      // Never answer a permission request. `list` can't trigger one; a
      // `setMode` resume might make the runtime replay a pending request, but
      // auto-approving (or declining) it from this throwaway connection would
      // be wrong — leave it unanswered so a real client (the UI) handles it on
      // its next connection. The connection closes right after the RPC anyway.
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
  /** List the agent's sessions, decoded from `_meta.platform`. Throws on
   *  connection / RPC failure (the caller maps it to a transport error). */
  list(agentId: string): Promise<SessionView[]>;
  /** Persist a session's mode via `session/resume` carrying
   *  `_meta.platform.mode` — the runtime intercept merges it. */
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
