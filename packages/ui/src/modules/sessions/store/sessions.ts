import type { StateCreator } from "zustand";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import type { PlatformStore } from "../../../store.js";
import { ACTION_FAILED, runAction } from "../../../store/query-helpers.js";
import type { LogEntry, Message } from "../../../types.js";
import { acpSessionsKeys } from "../api/queries.js";

/** A resume-time failure that blocks showing the session chat. Rendered inline. */
export interface SessionError {
  sessionId: string;
  message: string;
  /** "not-found" gets the "Delete orphaned session" action; others just show Back. */
  kind: "not-found" | "connection" | "other";
}

export interface SessionsSlice {
  sessionId: string | null;
  messages: Message[];
  log: LogEntry[];
  sessionError: SessionError | null;
  includeChannelSessions: boolean;
  queuedMessage: string | null;
  busy: boolean;

  setSessionId: (id: string | null) => void;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  setSessionError: (e: SessionError | null) => void;
  setIncludeChannelSessions: (v: boolean) => void;
  setQueuedMessage: (msg: string | null) => void;
  setBusy: (busy: boolean) => void;

  addLog: (type: string, payload: object) => void;
  /** Delete a session via the platform API, then invalidate the TQ session
   *  list query. Resets the chat context if the deleted session was active. */
  deleteSession: (sessionId: string) => Promise<void>;

  /**
   * Wipe all per-chat-session state (active session, messages, file tree,
   * session config, log, queued prompt). Callers like `selectInstance`,
   * `goBack`, and the popstate handler invoke this so every entry point
   * leaves chat state in the same clean shape.
   */
  resetChatContext: () => void;
}

export const createSessionsSlice: StateCreator<PlatformStore, [], [], SessionsSlice> = (set, get) => ({
  sessionId: null,
  messages: [],
  log: [],
  sessionError: null,
  includeChannelSessions: false,
  queuedMessage: null,
  busy: false,

  setSessionId: (id) => set({ sessionId: id }),
  setMessages: (updater) =>
    set((s) => ({ messages: typeof updater === "function" ? updater(s.messages) : updater })),
  setSessionError: (e) => set({ sessionError: e }),
  setIncludeChannelSessions: (v) => set({ includeChannelSessions: v }),
  setQueuedMessage: (msg) => set({ queuedMessage: msg }),
  setBusy: (busy) => set({ busy }),

  resetChatContext: () => set({
    sessionId: null,
    messages: [],
    sessionError: null,
    openFilePath: null,
    log: [],
    sessionModes: null,
    sessionModels: null,
    sessionConfigOptions: [],
    pendingPermissions: [],
    queuedMessage: null,
  }),

  addLog: (type, payload) => {
    const ts = new Date().toISOString().slice(11, 23);
    set((s) => ({ log: [...s.log, { id: crypto.randomUUID(), ts, type, payload }] }));
  },

  deleteSession: async (sessionId) => {
    const instanceId = get().selectedInstance;
    if (!instanceId) return;
    const ok = await runAction(
      () => api.sessions.delete.mutate({ sessionId, instanceId }),
      "Failed to delete session",
    );
    if (ok === ACTION_FAILED) return;
    if (get().sessionId === sessionId) get().resetChatContext();
    queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
    get().showToast({ kind: "success", message: "Session deleted" });
  },
});
