import type { SessionMode } from "api-server-api";
import type { StateCreator } from "zustand";

import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import type { PlatformStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { deleteAgentSession } from "../api/acp-session-ops.js";
import { acpSessionsKeys, removeSessionFromCache } from "../api/queries.js";

/** A resume-time failure that blocks showing the session chat. Rendered inline. */
export interface SessionError {
  sessionId: string;
  message: string;
  /** "not-found" gets the "Delete orphaned session" action; others just show Back. */
  kind: "not-found" | "connection" | "other";
}

export interface SessionsSlice {
  sessionId: string | null;
  sessionMode: SessionMode | null;
  messages: Message[];
  sessionError: SessionError | null;
  includeChannelSessions: boolean;
  queuedMessage: string | null;
  busy: boolean;
  terminalPaused: boolean;
  pendingResumeSessionId: string | null;

  setSessionId: (id: string | null) => void;
  setPendingResumeSessionId: (id: string | null) => void;
  setSessionMode: (mode: SessionMode | null) => void;
  setTerminalPaused: (paused: boolean) => void;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  setSessionError: (e: SessionError | null) => void;
  setIncludeChannelSessions: (v: boolean) => void;
  setQueuedMessage: (msg: string | null) => void;
  setBusy: (busy: boolean) => void;

  /** Delete a session via the platform API, drop it from the sidebar list
   *  cache immediately, then invalidate to reconcile. Resets the chat context
   *  if the deleted session was active. */
  deleteSession: (sessionId: string) => Promise<void>;

  /**
   * Wipe all per-chat-session state (active session, messages, file tree,
   * session config, queued prompt). Callers like `selectInstance`,
   * `goBack`, and the popstate handler invoke this so every entry point
   * leaves chat state in the same clean shape.
   */
  resetChatContext: () => void;
}

export const createSessionsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SessionsSlice
> = (set, get) => ({
  sessionId: null,
  sessionMode: null,
  messages: [],
  sessionError: null,
  includeChannelSessions: false,
  queuedMessage: null,
  busy: false,
  terminalPaused: false,
  pendingResumeSessionId: null,

  setSessionId: (id) => set({ sessionId: id }),
  setPendingResumeSessionId: (id) => set({ pendingResumeSessionId: id }),
  setSessionMode: (mode) => set({ sessionMode: mode }),
  setTerminalPaused: (paused) => set({ terminalPaused: paused }),
  setMessages: (updater) =>
    set((s) => ({
      messages: typeof updater === "function" ? updater(s.messages) : updater,
    })),
  setSessionError: (e) => set({ sessionError: e }),
  setIncludeChannelSessions: (v) => set({ includeChannelSessions: v }),
  setQueuedMessage: (msg) => set({ queuedMessage: msg }),
  setBusy: (busy) => set({ busy }),

  resetChatContext: () =>
    set({
      sessionId: null,
      sessionMode: null,
      messages: [],
      sessionError: null,
      terminalPaused: false,
      openFilePath: null,
      pendingPermissions: [],
      queuedMessage: null,
      pendingResumeSessionId: null,
    }),

  deleteSession: async (sessionId) => {
    const agentId = get().selectedAgent;
    if (!agentId) return;
    const ok = await runAction(
      () => deleteAgentSession(agentId, sessionId),
      "Failed to delete session",
    );
    if (ok === ACTION_FAILED) return;
    if (get().sessionId === sessionId) get().resetChatContext();
    // Cancel in-flight list refetches first — then drop the row and reconcile.
    await queryClient.cancelQueries({
      queryKey: acpSessionsKeys.agentLists(agentId),
    });
    removeSessionFromCache(agentId, sessionId);
    queryClient.invalidateQueries({
      queryKey: acpSessionsKeys.agentLists(agentId),
    });
    emitToast({ kind: "success", message: "Session deleted" });
  },
});
