import type {
  PodSession,
  PodSessionMode,
  PodSessionType,
} from "agent-runtime-api";

import type {
  SessionMetaEntry,
  SessionMetadataStore,
} from "../infrastructure/session-metadata-store.js";

const MODES: readonly string[] = ["chat", "terminal"];
const TYPES: readonly string[] = [
  "regular",
  "channel_slack",
  "channel_telegram",
  "schedule_cron",
  "experiment_execute",
];

const EPOCH = new Date(0).toISOString();

export interface ListedHarnessSession {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

function asMode(
  value: string | undefined,
  fallback: PodSessionMode,
): PodSessionMode {
  return value !== undefined && MODES.includes(value)
    ? (value as PodSessionMode)
    : fallback;
}

function asType(value: string | undefined): PodSessionType {
  return value !== undefined && TYPES.includes(value)
    ? (value as PodSessionType)
    : "regular";
}

function fromEntry(
  sessionId: string,
  entry: SessionMetaEntry,
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
  store: SessionMetadataStore,
  isRunning: (sessionId: string) => boolean,
): PodSession[] {
  const composed: PodSession[] = [];
  const listedIds = new Set<string>();

  for (const session of listed) {
    if (store.isTombstoned(session.sessionId)) continue;
    listedIds.add(session.sessionId);
    const entry = store.get(session.sessionId);
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

  for (const [sessionId, entry] of Object.entries(store.all())) {
    if (listedIds.has(sessionId) || store.isTombstoned(sessionId)) continue;
    composed.push(fromEntry(sessionId, entry, undefined, isRunning(sessionId)));
  }

  return composed;
}
