import type {
  SessionListQuery,
  SessionPage,
  SessionsService,
} from "agent-runtime-api";

import { noticeStream } from "../../../core/notice-stream.js";
import {
  composeSessionList,
  pageSessions,
  type ListedHarnessSession,
} from "../domain/session-list.js";
import type { InProcessCaller } from "../infrastructure/in-process-request.js";
import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";
import type { SessionChanges } from "./session-changes.js";

const HARNESS_LISTING_TTL_MS = 30_000;
const MAX_HARNESS_PAGES = 200;

interface HarnessListPage {
  sessions?: ListedHarnessSession[];
  nextCursor?: string | null;
}

async function readHarnessListing(
  caller: InProcessCaller,
): Promise<ListedHarnessSession[]> {
  await caller.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: {} },
    clientInfo: { name: "platform-sessions", version: "1.0.0" },
  });
  const byId = new Map<string, ListedHarnessSession>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_HARNESS_PAGES; page++) {
    const result = await caller.request<HarnessListPage>("session/list", {
      cwd: ".",
      ...(cursor !== undefined && { cursor }),
    });
    for (const session of result.sessions ?? []) {
      if (!byId.has(session.sessionId)) byId.set(session.sessionId, session);
    }
    cursor = result.nextCursor ?? undefined;
    if (cursor === undefined) break;
  }
  return [...byId.values()];
}

export function createSessionsService(deps: {
  openCaller: () => InProcessCaller;
  sessionMetadata: SessionMetadataStore;
  isRunning: (sessionId: string) => boolean;
  changes: SessionChanges;
  now?: () => number;
}): SessionsService {
  const now = deps.now ?? Date.now;
  let listing:
    { readAt: number; sessions: Promise<ListedHarnessSession[]> } | undefined;
  deps.changes.watch(() => {
    listing = undefined;
  });

  function harnessListing(): Promise<ListedHarnessSession[]> {
    if (listing && now() - listing.readAt < HARNESS_LISTING_TTL_MS)
      return listing.sessions;
    const caller = deps.openCaller();
    const entry = {
      readAt: now(),
      sessions: readHarnessListing(caller).finally(() => caller.close()),
    };
    entry.sessions.catch(() => {
      if (listing === entry) listing = undefined;
    });
    listing = entry;
    return entry.sessions;
  }

  return {
    async list(query?: SessionListQuery): Promise<SessionPage> {
      const composed = composeSessionList(
        await harnessListing(),
        deps.sessionMetadata.all(),
        {
          isTombstoned: (sessionId) =>
            deps.sessionMetadata.isTombstoned(sessionId),
          isRunning: deps.isRunning,
        },
      );
      return pageSessions(composed, query);
    },

    watch: (signal) =>
      noticeStream(
        { topic: "sessions" } as const,
        (onChange) => {
          const unsubscribe = deps.changes.subscribe(onChange);
          return { close: unsubscribe };
        },
        signal,
      ),
  };
}
