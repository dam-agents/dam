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
  loadDraftSnapshot,
  onForeignDraftChange,
  saveDraftSnapshot,
} from "../lib/draft-snapshot.js";
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
  consumeDroppedAttachments: (key: string) => void;
  pruneDrafts: (agentId: string, liveSessionIds: readonly string[]) => void;
  clearAgentDrafts: (agentId: string) => void;
  mergeForeignDrafts: (foreign: Record<string, SessionDraft>) => void;
  setBusy: (busy: boolean) => void;

  deleteSession: (sessionId: string) => Promise<boolean>;

  resetChatContext: () => void;
}

export const createSessionsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SessionsSlice
> = (set, get) => {
  const updateDrafts = (
    recipe: (drafts: Record<string, SessionDraft>) => boolean,
  ) => {
    const drafts = { ...get().drafts };
    if (!recipe(drafts)) return;
    set({ drafts });
    saveDraftSnapshot(drafts);
  };

  const dropAgentKeys = (agentId: string, doomed: (key: string) => boolean) => {
    const prefix = `${agentId}:`;
    updateDrafts((drafts) => {
      let changed = false;
      for (const key of Object.keys(drafts)) {
        if (!key.startsWith(prefix) || !doomed(key)) continue;
        delete drafts[key];
        changed = true;
      }
      return changed;
    });
  };

  onForeignDraftChange((foreign) => get().mergeForeignDrafts(foreign));

  return {
    sessionId: null,
    sessionMode: null,
    messages: [],
    sessionError: null,
    sessionFilter: [...SESSION_CATEGORIES],
    drafts: loadDraftSnapshot(),
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
      updateDrafts((drafts) => {
        const next = { ...(drafts[key] ?? EMPTY_DRAFT), ...patch };
        const empty =
          next.text.length === 0 &&
          next.attachments.length === 0 &&
          !next.droppedAttachmentNames?.length;
        if (empty && !(key in drafts)) return false;
        if (empty) delete drafts[key];
        else drafts[key] = next;
        return true;
      }),
    clearDraft: (key) =>
      updateDrafts((drafts) => {
        if (!(key in drafts)) return false;
        delete drafts[key];
        return true;
      }),
    migrateDraft: (fromKey, toKey) =>
      updateDrafts((drafts) => {
        const moving = drafts[fromKey];
        if (!moving) return false;
        delete drafts[fromKey];
        drafts[toKey] = moving;
        return true;
      }),
    consumeDroppedAttachments: (key) =>
      updateDrafts((drafts) => {
        const entry = drafts[key];
        if (!entry?.droppedAttachmentNames) return false;
        if (entry.text.length === 0 && entry.attachments.length === 0) {
          delete drafts[key];
        } else {
          drafts[key] = { text: entry.text, attachments: entry.attachments };
        }
        return true;
      }),
    pruneDrafts: (agentId, liveSessionIds) => {
      const keep = new Set(liveSessionIds.map((id) => draftKey(agentId, id)));
      keep.add(draftKey(agentId, null));
      keep.add(draftKey(agentId, get().sessionId));
      dropAgentKeys(agentId, (key) => !keep.has(key));
    },
    clearAgentDrafts: (agentId) => dropAgentKeys(agentId, () => true),
    mergeForeignDrafts: (foreign) =>
      updateDrafts((drafts) => {
        let changed = false;
        for (const [key, entry] of Object.entries(foreign)) {
          if (key in drafts) continue;
          drafts[key] = entry;
          changed = true;
        }
        return changed;
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
  };
};
