import type { SessionMode } from "api-server-api";
import type { StateCreator } from "zustand";

import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import type { PlatformStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import type { SessionFailureKind } from "../../acp/errors.js";
import { deleteAgentSession } from "../api/acp-session-ops.js";
import { acpSessionsKeys, removeSessionFromCache } from "../api/queries.js";
import {
  SESSION_CATEGORIES,
  type SessionCategory,
} from "../lib/session-category.js";

export interface SessionError {
  sessionId: string;
  kind: SessionFailureKind;
}

export interface SessionsSlice {
  sessionId: string | null;
  sessionMode: SessionMode | null;
  messages: Message[];
  sessionError: SessionError | null;
  sessionFilter: SessionCategory[];
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
  toggleSessionFilter: (category: SessionCategory) => void;
  setQueuedMessage: (msg: string | null) => void;
  setBusy: (busy: boolean) => void;

  deleteSession: (sessionId: string) => Promise<boolean>;

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
  sessionFilter: [...SESSION_CATEGORIES],
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
  toggleSessionFilter: (category) =>
    set((s) => ({
      sessionFilter: s.sessionFilter.includes(category)
        ? s.sessionFilter.filter((c) => c !== category)
        : [...s.sessionFilter, category],
    })),
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
      openArtifactId: null,
      openFileDirty: false,
      openFileEdit: false,
      pendingPermissions: [],
      queuedMessage: null,
      pendingResumeSessionId: null,
    }),

  deleteSession: async (sessionId) => {
    const agentId = get().selectedAgent;
    if (!agentId) return false;
    const ok = await runAction(
      () => deleteAgentSession(agentId, sessionId),
      "Failed to delete session",
    );
    if (ok === ACTION_FAILED) return false;
    if (get().sessionId === sessionId) get().resetChatContext();
    await queryClient.cancelQueries({
      queryKey: acpSessionsKeys.agentLists(agentId),
    });
    removeSessionFromCache(agentId, sessionId);
    queryClient.invalidateQueries({
      queryKey: acpSessionsKeys.agentLists(agentId),
    });
    emitToast({ kind: "success", message: "Session deleted" });
    return true;
  },
});
