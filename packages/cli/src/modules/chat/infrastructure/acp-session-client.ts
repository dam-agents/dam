import { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { WebSocket } from "ws";

/**
 * Sessions are agent-owned (ADR-055): there is no server session store. The CLI
 * reads and mutates them directly over the api-server's ACP relay WebSocket,
 * exactly like the UI and channel workers — listing decodes `_meta.platform`,
 * and a mode change rides `session/resume` with `_meta.platform.mode`.
 */

interface PlatformMeta {
  mode?: string;
  type?: string;
  scheduleId?: string;
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

/** Decode an ACP-listed session into a SessionView (ADR-055): no `_meta.platform`
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
    title: s.title ?? null,
    updatedAt: s.updatedAt ?? null,
  };
}

async function withConnection<T>(
  url: string,
  fn: (conn: ClientSideConnection) => Promise<T>,
): Promise<T> {
  const { stream, ws } = await wsStream(url);
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
      clientInfo: { name: "platform-cli-sessions", version: "1.0.0" },
    });
    return await fn(connection);
  } finally {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
      ws.close();
  }
}

export interface AcpSessionClient {
  /** List the agent's sessions, decoded from `_meta.platform`. Throws on
   *  connection / RPC failure (the caller maps it to a transport error). */
  list(agentId: string): Promise<SessionView[]>;
  /** Persist a session's mode via `session/resume` carrying
   *  `_meta.platform.mode` — the runtime intercept merges it (ADR-055). */
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
