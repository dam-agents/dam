import type {
  PodSession,
  SessionHistory,
  SessionsService,
} from "agent-runtime-api";

import { noticeStream } from "../../../core/notice-stream.js";
import {
  composeSessionList,
  type ListedHarnessSession,
} from "../domain/session-list.js";
import type { HistoryProvider } from "../infrastructure/history-provider.js";
import type { InProcessCaller } from "../infrastructure/in-process-request.js";
import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";
import type { SessionChanges } from "./session-changes.js";

const EMPTY_HISTORY: SessionHistory = { frames: [], truncated: false };

export function createSessionsService(deps: {
  openCaller: () => InProcessCaller;
  sessionMetadata: SessionMetadataStore;
  isRunning: (sessionId: string) => boolean;
  changes: SessionChanges;
  sessionFrames: (sessionId: string) => SessionHistory;
  historyProvider?: HistoryProvider;
}): SessionsService {
  return {
    async list(): Promise<PodSession[]> {
      const caller = deps.openCaller();
      try {
        await caller.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: {} },
          clientInfo: { name: "platform-sessions", version: "1.0.0" },
        });
        const result = await caller.request<{
          sessions?: ListedHarnessSession[];
        }>("session/list", { cwd: "." });
        return composeSessionList(
          result.sessions ?? [],
          deps.sessionMetadata.all(),
          {
            isTombstoned: (sessionId) =>
              deps.sessionMetadata.isTombstoned(sessionId),
            isRunning: deps.isRunning,
          },
        );
      } finally {
        caller.close();
      }
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
