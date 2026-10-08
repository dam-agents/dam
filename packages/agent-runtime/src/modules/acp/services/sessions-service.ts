import type {
  SessionHistory,
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
import { spendBySession, spendTotal } from "../domain/session-spend.js";
import type { DelegationFramesStore } from "../infrastructure/delegation-frames-store.js";
import type { HistoryProvider } from "../infrastructure/history-provider.js";
import type { InProcessCaller } from "../infrastructure/in-process-request.js";
import type { SpendProvider } from "../infrastructure/spend-provider.js";
import type { PlatformSessionOf } from "../infrastructure/terminal-session-pins.js";
import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";
import type { SessionChanges } from "./session-changes.js";

const EMPTY_HISTORY: SessionHistory = { frames: [], truncated: false };

const HARNESS_LISTING_TTL_MS = 30_000;
const MAX_HARNESS_PAGES = 200;

interface HarnessListPage {
  sessions?: ListedHarnessSession[];
  nextCursor?: string | null;
}

async function readHarnessListing(
  caller: InProcessCaller,
  log: (msg: string) => void,
): Promise<ListedHarnessSession[]> {
  await caller.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: {} },
    clientInfo: { name: "platform-sessions", version: "1.0.0" },
  });
  const byId = new Map<string, ListedHarnessSession>();
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page === MAX_HARNESS_PAGES) {
      log(
        `session list: stopped after ${MAX_HARNESS_PAGES} harness pages with ${byId.size} sessions; older ones are not listed`,
      );
      break;
    }
    const result = await caller.request<HarnessListPage>("session/list", {
      cwd: ".",
      ...(cursor !== undefined && { cursor }),
    });
    for (const { sessionId, title, updatedAt } of result.sessions ?? []) {
      if (!byId.has(sessionId))
        byId.set(sessionId, {
          sessionId,
          title: title ?? null,
          updatedAt: updatedAt ?? null,
        });
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
  sessionFrames: (sessionId: string) => SessionHistory;
  delegations: DelegationFramesStore;
  historyProvider?: HistoryProvider;
  spendProvider?: SpendProvider;
  terminalSessionPins?: () => PlatformSessionOf;
  log: (msg: string) => void;
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
      sessions: readHarnessListing(caller, deps.log).finally(() =>
        caller.close(),
      ),
    };
    entry.sessions.catch(() => {
      if (listing === entry) listing = undefined;
    });
    listing = entry;
    return entry.sessions;
  }

  return {
    async list(query?: SessionListQuery): Promise<SessionPage> {
      const platformSessionOf = deps.terminalSessionPins?.();
      const [listed, spendRows] = await Promise.all([
        harnessListing(),
        deps.spendProvider?.read() ?? Promise.resolve(null),
      ]);
      const composed = composeSessionList(listed, deps.sessionMetadata.all(), {
        isTombstoned: (sessionId) =>
          deps.sessionMetadata.isTombstoned(sessionId),
        isRunning: deps.isRunning,
        platformSessionOf,
      });
      const page = pageSessions(composed, query);
      if (!deps.spendProvider || !spendRows) return page;
      const spend = spendBySession(
        spendRows,
        deps.spendProvider.unit,
        platformSessionOf,
      );
      return {
        ...page,
        sessions: page.sessions.map((session) => {
          const cost = spend.get(session.sessionId);
          return cost ? { ...session, spend: cost } : session;
        }),
      };
    },

    async spend({ from, to }) {
      if (!deps.spendProvider) return null;
      const rows = await deps.spendProvider.read();
      if (!rows) throw new Error("the harness did not report session spend");
      return spendTotal(rows, deps.spendProvider.unit, {
        from: Date.parse(from),
        to: Date.parse(to),
      });
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: a session's replay read as data rather than
     * over the chat protocol, for a caller that wants to keep the conversation
     * rather than show it. The live transcript answers while the session is
     * loaded; otherwise the harness image's own history provider does, which is
     * the same source a cold re-attach replays from. Neither having anything is
     * an empty answer, not a failure: a harness that declares no provider, or a
     * session that produced nothing, has nothing to keep.
     */
    async history(sessionId): Promise<SessionHistory> {
      const live = deps.sessionFrames(sessionId);
      if (live.frames.length > 0) return live;
      const stored = await deps.historyProvider?.fetch(sessionId);
      return stored ? { frames: stored, truncated: false } : EMPTY_HISTORY;
    },

    async storeDelegationFrames(input) {
      return deps.delegations.store(input);
    },

    async delegationFrames(invocationId) {
      return deps.delegations.read(invocationId);
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
