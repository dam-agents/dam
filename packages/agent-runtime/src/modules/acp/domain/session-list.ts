import {
  podSessionModeSchema,
  podSessionTypeSchema,
  type PodSession,
  type PodSessionMode,
  type PodSessionType,
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
    experimentId?: string;
    threadTs?: string;
  };
  createdAt: string;
  lastActivityAt?: string;
  seenAt?: string;
}

export interface SessionListPredicates {
  isTombstoned: (sessionId: string) => boolean;
  isRunning: (sessionId: string) => boolean;
}

function asMode(
  value: string | undefined,
  fallback: PodSessionMode,
): PodSessionMode {
  const parsed = podSessionModeSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
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
    mode: asMode(entry.meta.mode, "chat"),
    type: asType(entry.meta.type),
    createdAt: entry.createdAt,
    updatedAt: entry.lastActivityAt ?? listed?.updatedAt ?? null,
    title: listed?.title ?? null,
    scheduleId: entry.meta.scheduleId ?? null,
    experimentId: entry.meta.experimentId ?? null,
    threadTs: entry.meta.threadTs ?? null,
    seenAt: entry.seenAt ?? null,
    running,
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
    experimentId: null,
    threadTs: null,
    seenAt: null,
    running,
  };
}

export function composeSessionList(
  listed: readonly ListedHarnessSession[],
  entries: Readonly<Record<string, SessionMetaLike>>,
  { isTombstoned, isRunning }: SessionListPredicates,
): PodSession[] {
  const composed: PodSession[] = [];
  const listedIds = new Set<string>();

  for (const session of listed) {
    if (isTombstoned(session.sessionId)) continue;
    listedIds.add(session.sessionId);
    const entry = entries[session.sessionId];
    composed.push(
      entry
        ? fromEntry(
            session.sessionId,
            entry,
            session,
            isRunning(session.sessionId),
          )
        : fromHarnessOnly(session, isRunning(session.sessionId)),
    );
  }

  for (const [sessionId, entry] of Object.entries(entries)) {
    if (listedIds.has(sessionId) || isTombstoned(sessionId)) continue;
    composed.push(fromEntry(sessionId, entry, undefined, isRunning(sessionId)));
  }

  return composed;
}
