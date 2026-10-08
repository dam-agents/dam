import type { ClientConnection } from "@agentclientprotocol/sdk";
import {
  type PodSession,
  type SessionListCursor,
  type SessionListQuery,
  sessionMatchesQuery,
} from "agent-runtime-api";
import {
  type PlatformUndeliveredPrompt,
  SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";

import { openInitializedConnection } from "../../acp/acp.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import { agentLacksLiveUpdates } from "../../agents/api/queries.js";

interface PlatformMeta {
  mode?: string;
  type?: string;
  scheduleId?: string;
  initialization?: boolean;
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

const SESSION_TYPES: readonly string[] = Object.values(SessionType);

function asSessionType(value: string | undefined): SessionType {
  return value !== undefined && SESSION_TYPES.includes(value)
    ? (value as SessionType)
    : SessionType.Regular;
}

function toSessionView(agentId: string, s: ListedSession): SessionView {
  const p = s._meta?.platform;
  return {
    sessionId: s.sessionId,
    agentId,
    type: asSessionType(p?.type),
    mode: p
      ? ((p.mode as SessionMode) ?? SessionMode.Chat)
      : SessionMode.Terminal,
    createdAt: p?.createdAt ?? s.updatedAt ?? new Date(0).toISOString(),
    scheduleId: p?.scheduleId ?? null,
    initialization: p?.initialization ?? null,
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
  agentId: string,
  fn: (conn: ClientConnection) => Promise<T>,
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

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byRecencyThenId(a: SessionView, b: SessionView): number {
  return (
    compareCodeUnits(b.updatedAt ?? b.createdAt, a.updatedAt ?? a.createdAt) ||
    compareCodeUnits(a.sessionId, b.sessionId)
  );
}

async function listSessionsOn(
  agentId: string,
  conn: ClientConnection,
): Promise<SessionView[]> {
  const r = await conn.agent.request("session/list", { cwd: "." });
  return (r.sessions ?? [])
    .map((s) => toSessionView(agentId, s as unknown as ListedSession))
    .sort(byRecencyThenId);
}

const POD_TYPE: Record<PodSession["type"], SessionType> = {
  regular: SessionType.Regular,
  channel_slack: SessionType.ChannelSlack,
  channel_telegram: SessionType.ChannelTelegram,
  schedule_cron: SessionType.ScheduleCron,
  schedule_once: SessionType.ScheduleOnce,
  cli_run: SessionType.CliRun,
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
    initialization: s.initialization ?? null,
    threadTs: s.threadTs,
    title: s.title,
    updatedAt: s.updatedAt,
    running: s.running,
    seenAt: s.seenAt,
    runStartedAt: s.runStartedAt,
    runTotalMs: s.runTotalMs,
    runCount: s.runCount,
    ...(s.spend ? { spend: s.spend } : {}),
  };
}

export interface SessionViewPage {
  sessions: SessionView[];
  nextCursor: SessionListCursor | null;
}

export async function listAgentSessionPage(
  agentId: string,
  query: SessionListQuery = {},
): Promise<SessionViewPage> {
  if (agentLacksLiveUpdates(agentId)) {
    const sessions = await withConnection(
      agentId,
      (conn) => listSessionsOn(agentId, conn),
      { passive: true },
    );
    return {
      sessions: sessions.filter((s) => sessionMatchesQuery(s, query)),
      nextCursor: null,
    };
  }
  const page = await agentTrpc(agentId).sessions.list.query(query);
  return {
    sessions: page.sessions
      .map((s) => toSessionViewFromPod(agentId, s))
      .filter((s) => sessionMatchesQuery(s, query))
      .sort(byRecencyThenId),
    nextCursor: page.nextCursor ?? null,
  };
}

export async function findAgentSession(
  agentId: string,
  sessionId: string,
): Promise<SessionView | null> {
  const { sessions } = await listAgentSessionPage(agentId, {
    sessionId,
    limit: 1,
  });
  return sessions[0] ?? null;
}

export async function deleteAgentSession(
  agentId: string,
  sessionId: string,
): Promise<void> {
  await withConnection(agentId, (conn) =>
    conn.agent.request("platform/deleteSession", { sessionId }),
  );
}

export async function forgetUndeliveredPrompt(
  agentId: string,
  sessionId: string,
  id: string,
): Promise<void> {
  await withConnection(agentId, (conn) =>
    conn.agent.request("platform/forgetUndelivered", { sessionId, id }),
  );
}

export async function handOverUndelivered(
  agentId: string,
  sessionId: string,
  prompts: PlatformUndeliveredPrompt[],
): Promise<void> {
  if (prompts.length === 0) return;
  await withConnection(agentId, (conn) =>
    conn.agent.request("platform/recordUndelivered", { sessionId, prompts }),
  );
}

export async function setSessionMode(
  agentId: string,
  sessionId: string,
  mode: SessionMode,
): Promise<void> {
  await withConnection(agentId, (conn) =>
    conn.agent.request("session/resume", {
      sessionId,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { mode } },
    }),
  );
}
