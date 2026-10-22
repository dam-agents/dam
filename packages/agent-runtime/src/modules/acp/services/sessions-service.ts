import type {
  SessionHistory,
  SessionListQuery,
  SessionPage,
  SessionRepository,
  SessionsService,
  SessionSubAgentContext,
} from "agent-runtime-api";

import { noticeStream } from "../../../core/notice-stream.js";
import {
  composeSessionList,
  pageSessions,
  type ListedHarnessSession,
} from "../domain/session-list.js";
import { historyTailStart } from "../domain/replay-tail.js";
import type { DelegationFramesStore } from "../infrastructure/delegation-frames-store.js";
import type { HistoryProvider } from "../infrastructure/history-provider.js";
import type { InProcessCaller } from "../infrastructure/in-process-request.js";
import type { PlatformSessionOf } from "../infrastructure/terminal-session-pins.js";
import type {
  PlatformSessionMeta,
  SessionMetadataStore,
} from "../infrastructure/session-metadata-store.js";
import type { SessionChanges } from "./session-changes.js";

const EMPTY_HISTORY: SessionHistory = { frames: [], truncated: false };

function newestTail(
  history: SessionHistory,
  tail: number | undefined,
): SessionHistory {
  if (tail === undefined) return history;
  const start = historyTailStart(history.frames, tail);
  return start === 0
    ? history
    : { frames: history.frames.slice(start), truncated: true };
}

const HARNESS_LISTING_TTL_MS = 30_000;
// UNIT_BOUNDARY_DESCRIPTION: how long a list read waits for a harness listing still being read. The first read after a boot starts the harness cold, which takes seconds; past this the read answers from the platform's own session records and the last listing, and announces a change once the harness answers.
const HARNESS_LISTING_GRACE_MS = 300;

const HARNESS_ONLY_META: PlatformSessionMeta = { mode: "terminal" };
const MAX_HARNESS_PAGES = 200;

interface HarnessListPage {
  sessions?: (ListedHarnessSession & {
    _meta?: { platform?: { autoTitle?: string | null } };
  })[];
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
    for (const { sessionId, title, updatedAt, _meta } of result.sessions ??
      []) {
      const autoTitle = _meta?.platform?.autoTitle;
      if (!byId.has(sessionId))
        byId.set(sessionId, {
          sessionId,
          title: (autoTitle !== undefined ? autoTitle : title) ?? null,
          updatedAt: updatedAt ?? null,
        });
    }
    cursor = result.nextCursor ?? undefined;
    if (cursor === undefined) break;
  }
  return [...byId.values()];
}

export interface RuntimeSessionsService extends SessionsService {
  adoptHarnessTitle(sessionId: string): Promise<void>;
}

const firstLine = (title: string | null | undefined): string =>
  (title ?? "").trim().split("\n")[0]!.trim();

export function createSessionsService(deps: {
  defaultHarness?: string;
  subAgentContextOf: (
    meta: PlatformSessionMeta,
  ) => Omit<SessionSubAgentContext, "settings">;
  openCaller: () => InProcessCaller;
  sessionMetadata: SessionMetadataStore;
  isRunning: (sessionId: string) => boolean;
  changes: SessionChanges;
  sessionFrames: (sessionId: string) => SessionHistory;
  delegations: DelegationFramesStore;
  historyProvider?: HistoryProvider;
  terminalSessionPins?: () => PlatformSessionOf;
  sessionRepositories?: (sessionId: string) => SessionRepository[];
  log: (msg: string) => void;
  now?: () => number;
}): RuntimeSessionsService {
  const now = deps.now ?? Date.now;
  const adopting = new Set<string>();
  let listing:
    | {
        readAt: number;
        sessions: Promise<ListedHarnessSession[]>;
        announced: boolean;
      }
    | undefined;
  let lastListed: ListedHarnessSession[] = [];
  deps.changes.watch(() => {
    listing = undefined;
  });

  function harnessListing() {
    if (listing && now() - listing.readAt < HARNESS_LISTING_TTL_MS)
      return listing;
    const caller = deps.openCaller();
    const entry = {
      readAt: now(),
      sessions: readHarnessListing(caller, deps.log).finally(() =>
        caller.close(),
      ),
      announced: false,
    };
    entry.sessions.then(
      (sessions) => {
        lastListed = sessions;
      },
      () => {
        if (listing === entry) listing = undefined;
      },
    );
    listing = entry;
    return entry;
  }

  async function listedWithinGrace(): Promise<{
    listed: ListedHarnessSession[];
    complete: boolean;
  }> {
    const entry = harnessListing();
    const late = Symbol("late");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      entry.sessions,
      new Promise<typeof late>((resolve) => {
        timer = setTimeout(() => resolve(late), HARNESS_LISTING_GRACE_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (result !== late) return { listed: result, complete: true };
    if (!entry.announced) {
      entry.announced = true;
      entry.sessions.then(
        () => deps.changes.announce(),
        (error: unknown) => {
          deps.log(
            `session list: the harness listing failed after the list was answered without it: ${error instanceof Error ? error.message : String(error)}`,
          );
          deps.changes.announce();
        },
      );
    }
    return { listed: lastListed, complete: false };
  }

  function withRepositories(page: SessionPage): SessionPage {
    const repositoriesOf = deps.sessionRepositories;
    if (!repositoriesOf) return page;
    return {
      ...page,
      sessions: page.sessions.map((session) => {
        const repositories = repositoriesOf(session.sessionId);
        return repositories.length > 0 ? { ...session, repositories } : session;
      }),
    };
  }

  return {
    async list(query?: SessionListQuery): Promise<SessionPage> {
      const platformSessionOf = deps.terminalSessionPins?.();
      const { listed, complete } = await listedWithinGrace();
      const composed = composeSessionList(listed, deps.sessionMetadata.all(), {
        isTombstoned: (sessionId) =>
          deps.sessionMetadata.isTombstoned(sessionId),
        isRunning: deps.isRunning,
        platformSessionOf,
      });
      const paged = withRepositories(pageSessions(composed, query));
      return complete ? paged : { ...paged, incomplete: true };
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
    async history(sessionId, opts): Promise<SessionHistory> {
      const live = deps.sessionFrames(sessionId);
      if (live.frames.length > 0) return newestTail(live, opts?.tail);
      const stored = await deps.historyProvider?.fetch(sessionId);
      return stored
        ? newestTail({ frames: stored, truncated: false }, opts?.tail)
        : EMPTY_HISTORY;
    },

    /**
     * UNIT_BOUNDARY_DESCRIPTION: a terminal Session sends no prompt over ACP,
     * so the platform never derives its title; only its harness knows one.
     * The list read never starts a harness, so the title is asked for once
     * the terminal detaches or exits, from that harness's own listing, and
     * kept as the Session's title. A title already kept or set by a person
     * stays.
     */
    async adoptHarnessTitle(sessionId) {
      const entry = deps.sessionMetadata.get(sessionId);
      if (
        !entry ||
        entry.meta.mode !== "terminal" ||
        entry.meta.title ||
        entry.meta.customTitle ||
        adopting.has(sessionId)
      )
        return;
      adopting.add(sessionId);
      const caller = deps.openCaller();
      try {
        await caller.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: {} },
          clientInfo: { name: "platform-sessions", version: "1.0.0" },
        });
        const harness = entry.meta.harness ?? deps.defaultHarness;
        if (harness === undefined) return;
        let cursor: string | undefined;
        let title = "";
        for (let page = 0; page < MAX_HARNESS_PAGES && !title; page++) {
          const result = await caller.request<HarnessListPage>("session/list", {
            cwd: ".",
            _meta: { platform: { harness } },
            ...(cursor !== undefined && { cursor }),
          });
          title = firstLine(
            result.sessions?.find((s) => s.sessionId === sessionId)?.title,
          );
          cursor = result.nextCursor ?? undefined;
          if (cursor === undefined) break;
        }
        const fresh = deps.sessionMetadata.get(sessionId);
        if (title && fresh && !fresh.meta.title && !fresh.meta.customTitle)
          deps.sessionMetadata.set(sessionId, { ...fresh.meta, title });
      } catch (error) {
        deps.log(
          `session ${sessionId}: the harness title could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        caller.close();
        adopting.delete(sessionId);
      }
    },

    async setTitle(input) {
      const sessionId =
        "ref" in input
          ? deps.sessionMetadata.findByRef(input.ref)
          : input.sessionId;
      if (
        sessionId === undefined ||
        deps.sessionMetadata.isTombstoned(sessionId)
      )
        return false;
      const entry = deps.sessionMetadata.get(sessionId);
      if (
        !entry &&
        !(await harnessListing().sessions).some(
          (s) => s.sessionId === sessionId,
        )
      )
        return false;
      const { customTitle: _previous, ...meta } =
        entry?.meta ?? HARNESS_ONLY_META;
      deps.sessionMetadata.set(
        sessionId,
        input.title === null ? meta : { ...meta, customTitle: input.title },
      );
      return true;
    },

    async settings(input) {
      const sessionId = deps.sessionMetadata.findByRef(input.ref);
      if (
        sessionId === undefined ||
        deps.sessionMetadata.isTombstoned(sessionId)
      )
        return null;
      const meta = deps.sessionMetadata.get(sessionId)?.meta ?? {};
      return { settings: meta.settings ?? {}, ...deps.subAgentContextOf(meta) };
    },

    async byRef(ref) {
      const sessionId = deps.sessionMetadata.findByRef(ref);
      if (
        sessionId === undefined ||
        deps.sessionMetadata.isTombstoned(sessionId)
      )
        return null;
      return sessionId;
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
