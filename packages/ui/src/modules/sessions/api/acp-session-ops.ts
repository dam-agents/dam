import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import { SessionMode, SessionType, type SessionView } from "api-server-api";

import { openConnection } from "../../acp/acp.js";

interface PlatformMeta {
  mode?: string;
  type?: string;
  scheduleId?: string;
  experimentId?: string;
  threadTs?: string;
  createdAt?: string;
  running?: boolean;
  seenAt?: string;
}

interface ListedSession {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
  _meta?: { platform?: PlatformMeta };
}

/**
 * Decode an ACP-listed session into a SessionView. A session with no
 * `_meta.platform` is harness-minted (e.g. a terminal/`/clear` session) and
 * defaults to terminal; an ACP-created session carries a (possibly empty)
 * entry and defaults to chat.
 */
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
    running: p?.running ?? false,
    seenAt: p?.seenAt ?? null,
  };
}

/** Open a short-lived ACP connection to an agent for a one-shot, cross-session
 *  operation (list, delete) — distinct from the live chat connection. */
async function withConnection<T>(
  agentId: string,
  fn: (conn: ClientSideConnection) => Promise<T>,
  opts?: { passive?: boolean },
): Promise<T> {
  const { connection, ws } = await openConnection(agentId, () => {}, opts);
  try {
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "platform-ui-sessions", version: "1.0.0" },
    });
    return await fn(connection);
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

export async function listAgentSessions(
  agentId: string,
): Promise<SessionView[]> {
  // Passive: listing is a read and must not defer the agent's hibernation.
  return withConnection(
    agentId,
    async (conn) => {
      const r = await conn.listSessions({ cwd: "." });
      // Most-recently-active first; sessionId breaks ties for a stable order.
      return (r.sessions ?? [])
        .map((s) => toSessionView(agentId, s as unknown as ListedSession))
        .sort((a, b) => {
          const byActivity = (b.updatedAt ?? b.createdAt).localeCompare(
            a.updatedAt ?? a.createdAt,
          );
          return byActivity !== 0
            ? byActivity
            : a.sessionId.localeCompare(b.sessionId);
        });
    },
    { passive: true },
  );
}

export async function deleteAgentSession(
  agentId: string,
  sessionId: string,
): Promise<void> {
  await withConnection(agentId, (conn) =>
    conn.extMethod("platform/deleteSession", { sessionId }),
  );
}

/** Mode is metadata: a `session/resume` carrying
 *  `_meta.platform.mode` updates the stored entry via the runtime intercept. */
export async function setSessionMode(
  agentId: string,
  sessionId: string,
  mode: SessionMode,
): Promise<void> {
  await withConnection(agentId, (conn) =>
    conn.unstable_resumeSession({
      sessionId,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { mode } },
    }),
  );
}
