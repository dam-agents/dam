import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { PodSession } from "agent-runtime-api";
import { SessionMode, SessionType, type SessionView } from "api-server-api";

import { openInitializedConnection } from "../../acp/acp.js";
import { agentTrpc } from "../../agents/agent-trpc.js";

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
  };
}

async function withConnection<T>(
  agentId: string,
  fn: (conn: ClientSideConnection) => Promise<T>,
  opts?: { passive?: boolean },
): Promise<T> {
  const { connection, ws } = await openInitializedConnection(
    agentId,
    () => {},
    {
      ...opts,
      clientInfo: { name: "platform-ui-sessions", version: "1.0.0" },
    },
  );
  try {
    return await fn(connection);
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

function byRecencyThenId(a: SessionView, b: SessionView): number {
  const byActivity = (b.updatedAt ?? b.createdAt).localeCompare(
    a.updatedAt ?? a.createdAt,
  );
  return byActivity !== 0 ? byActivity : a.sessionId.localeCompare(b.sessionId);
}

export async function listSessionsOn(
  agentId: string,
  conn: ClientSideConnection,
): Promise<SessionView[]> {
  const r = await conn.listSessions({ cwd: "." });
  return (r.sessions ?? [])
    .map((s) => toSessionView(agentId, s as unknown as ListedSession))
    .sort(byRecencyThenId);
}

const POD_TYPE: Record<PodSession["type"], SessionType> = {
  regular: SessionType.Regular,
  channel_slack: SessionType.ChannelSlack,
  channel_telegram: SessionType.ChannelTelegram,
  schedule_cron: SessionType.ScheduleCron,
  experiment_execute: SessionType.ExperimentExecute,
};

const POD_MODE: Record<PodSession["mode"], SessionMode> = {
  chat: SessionMode.Chat,
  terminal: SessionMode.Terminal,
};

function toSessionViewFromPod(agentId: string, s: PodSession): SessionView {
  return {
    sessionId: s.sessionId,
    agentId,
    type: POD_TYPE[s.type],
    mode: POD_MODE[s.mode],
    createdAt: s.createdAt,
    scheduleId: s.scheduleId,
    experimentId: s.experimentId,
    threadTs: s.threadTs,
    title: s.title,
    updatedAt: s.updatedAt,
    running: s.running,
    seenAt: s.seenAt,
  };
}

export async function listAgentSessions(
  agentId: string,
): Promise<SessionView[]> {
  const { sessions } = await agentTrpc(agentId).sessions.list.query();
  return sessions
    .map((s) => toSessionViewFromPod(agentId, s))
    .sort(byRecencyThenId);
}

export async function listAgentSessionsOverAcp(
  agentId: string,
): Promise<SessionView[]> {
  return withConnection(agentId, (conn) => listSessionsOn(agentId, conn), {
    passive: true,
  });
}

export async function deleteAgentSession(
  agentId: string,
  sessionId: string,
): Promise<void> {
  await withConnection(agentId, (conn) =>
    conn.extMethod("platform/deleteSession", { sessionId }),
  );
}

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
