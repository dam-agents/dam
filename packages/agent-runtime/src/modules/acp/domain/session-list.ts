import {
  podSessionModeSchema,
  podSessionTypeSchema,
  sessionMatchesQuery,
  type PodSession,
  type PodSessionMode,
  type PodSessionType,
  type SessionDirectoryEntry,
  type SessionListCursor,
  type SessionListQuery,
  type SessionPage,
} from "agent-runtime-api";

const EPOCH = new Date(0).toISOString();

export interface ListedHarnessSession {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface SessionMetaLike {
  meta: {
    mode?: string;
    type?: string;
    scheduleId?: string;
    initialization?: boolean;
    threadTs?: string;
    harness?: string;
    provider?: string;
    model?: string;
    title?: string;
  };
  createdAt: string;
  lastActivityAt?: string;
  seenAt?: string;
  runStartedAt?: string;
  runTotalMs?: number;
  runCount?: number;
}

export interface SessionListPredicates {
  isTombstoned: (sessionId: string) => boolean;
  isRunning: (sessionId: string) => boolean;
  platformSessionOf?: (harnessSessionId: string) => string | undefined;
}

function asMode(value: string | undefined): PodSessionMode {
  const parsed = podSessionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "chat";
}

function asType(value: string | undefined): PodSessionType {
  const parsed = podSessionTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "regular";
}

function fromEntry(
  sessionId: string,
  entry: SessionMetaLike,
  listed: ListedHarnessSession | undefined,
  running: boolean,
): PodSession {
  return {
    sessionId,
    mode: asMode(entry.meta.mode),
    type: asType(entry.meta.type),
    createdAt: entry.createdAt,
    updatedAt: entry.lastActivityAt ?? listed?.updatedAt ?? null,
    title: listed?.title ?? entry.meta.title ?? null,
    scheduleId: entry.meta.scheduleId ?? null,
    initialization: entry.meta.initialization === true,
    threadTs: entry.meta.threadTs ?? null,
    seenAt: entry.seenAt ?? null,
    runStartedAt: entry.runStartedAt ?? null,
    runTotalMs: entry.runTotalMs ?? null,
    runCount: entry.runCount ?? null,
    running,
    ...(entry.meta.harness !== undefined && { harness: entry.meta.harness }),
    ...(entry.meta.provider !== undefined && {
      provider: entry.meta.provider,
    }),
    ...(entry.meta.model !== undefined && { model: entry.meta.model }),
  };
}

function fromHarnessOnly(
  listed: ListedHarnessSession,
  running: boolean,
): PodSession {
  return {
    sessionId: listed.sessionId,
    mode: "terminal",
    type: "regular",
    createdAt: listed.updatedAt ?? EPOCH,
    updatedAt: listed.updatedAt ?? null,
    title: listed.title ?? null,
    scheduleId: null,
    initialization: false,
    threadTs: null,
    seenAt: null,
    runStartedAt: null,
    runTotalMs: null,
    runCount: null,
    running,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one Session list both read paths serve. A
 * harness session pinned to a terminal Session (`platformSessionOf`) is listed
 * once, under the terminal Session's id: a harness that mints its own id for a
 * terminal conversation would otherwise show it twice, and opening the
 * harness-id row would start an empty terminal. A store entry under a pinned
 * harness id is left out for the same reason: it is the record of such an
 * opening, not a Session of its own.
 */
export function composeSessionList(
  listed: readonly ListedHarnessSession[],
  entries: Readonly<Record<string, SessionMetaLike>>,
  { isTombstoned, isRunning, platformSessionOf }: SessionListPredicates,
): PodSession[] {
  const composed: PodSession[] = [];
  const listedById = new Map<string, ListedHarnessSession>();

  for (const harnessSession of listed) {
    const sessionId =
      platformSessionOf?.(harnessSession.sessionId) ?? harnessSession.sessionId;
    if (isTombstoned(sessionId) || listedById.has(sessionId)) continue;
    const session = { ...harnessSession, sessionId };
    listedById.set(sessionId, session);
    const entry = entries[sessionId];
    composed.push(
      entry
        ? fromEntry(sessionId, entry, session, isRunning(sessionId))
        : fromHarnessOnly(session, isRunning(sessionId)),
    );
  }

  for (const [sessionId, entry] of Object.entries(entries)) {
    if (
      listedById.has(sessionId) ||
      isTombstoned(sessionId) ||
      platformSessionOf?.(sessionId) !== undefined
    )
      continue;
    composed.push(fromEntry(sessionId, entry, undefined, isRunning(sessionId)));
  }

  return composed;
}

function activityAt(session: PodSession): string {
  return session.updatedAt ?? session.createdAt;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareToCursor(
  session: PodSession,
  cursor: SessionListCursor,
): number {
  return (
    compareCodeUnits(cursor.activityAt, activityAt(session)) ||
    compareCodeUnits(session.sessionId, cursor.sessionId)
  );
}

function cursorOf(session: PodSession): SessionListCursor {
  return { activityAt: activityAt(session), sessionId: session.sessionId };
}

export function pageSessions(
  sessions: readonly PodSession[],
  query: SessionListQuery = {},
): SessionPage {
  const { after, limit } = query;
  const ordered = sessions
    .filter(
      (s) =>
        sessionMatchesQuery(s, query) &&
        (!after || compareToCursor(s, after) > 0),
    )
    .sort((a, b) => compareToCursor(a, cursorOf(b)));
  if (limit === undefined || ordered.length <= limit)
    return { sessions: ordered, nextCursor: null };
  const page = ordered.slice(0, limit);
  return { sessions: page, nextCursor: cursorOf(page[page.length - 1]!) };
}

export function sessionDirectoryEntries(
  entries: Readonly<Record<string, SessionMetaLike>>,
  isTombstoned: (sessionId: string) => boolean,
): SessionDirectoryEntry[] {
  return Object.entries(entries)
    .filter(([sessionId]) => !isTombstoned(sessionId))
    .map(([sessionId, entry]) => ({
      sessionId,
      mode: asMode(entry.meta.mode),
      type: asType(entry.meta.type),
      createdAt: entry.createdAt,
    }));
}
