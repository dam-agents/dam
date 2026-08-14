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
import { draftKey, EMPTY_DRAFT, type SessionDraft } from "../lib/draft-key.js";
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
  drafts: Record<string, SessionDraft>;
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
  setDraft: (key: string, patch: Partial<SessionDraft>) => void;
  clearDraft: (key: string) => void;
  migrateDraft: (fromKey: string, toKey: string) => void;
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
  drafts: {},
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
  setDraft: (key, patch) =>
    set((s) => {
      const next = { ...(s.drafts[key] ?? EMPTY_DRAFT), ...patch };
      const drafts = { ...s.drafts };
      if (next.text.length === 0 && next.attachments.length === 0) {
        if (!(key in drafts)) return {};
        delete drafts[key];
      } else {
        drafts[key] = next;
      }
      return { drafts };
    }),
  clearDraft: (key) =>
    set((s) => {
      if (!(key in s.drafts)) return {};
      const drafts = { ...s.drafts };
      delete drafts[key];
      return { drafts };
    }),
  migrateDraft: (fromKey, toKey) =>
    set((s) => {
      const moving = s.drafts[fromKey];
      if (!moving) return {};
      const drafts = { ...s.drafts };
      delete drafts[fromKey];
      drafts[toKey] = moving;
      return { drafts };
    }),
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
    get().clearDraft(draftKey(agentId, sessionId));
    queryClient.invalidateQueries({
      queryKey: acpSessionsKeys.agentLists(agentId),
    });
    emitToast({ kind: "success", message: "Session deleted" });
    return true;
  },
});
