import type { Sender } from "agent-runtime-api";
import {
  type PlatformContinuedFrom,
  type PlatformSenderEntry,
  type PlatformUndeliveredPrompt,
  type PlatformVerdict,
  type QueuedPrompt,
  SESSION_CATEGORIES,
  type SessionCategory,
  type SessionMode,
  type SessionPair,
  type SessionSteering,
} from "api-server-api";
import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { ACTION_FAILED, runAction } from "../../../lib/query-helpers.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import type { PlatformStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import type { SessionFailureKind } from "../../acp/errors.js";
import { deleteAgentSession } from "../api/acp-session-ops.js";
import { acpSessionsKeys } from "../api/keys.js";
import { removeSessionFromCache } from "../api/queries.js";
import { draftKey, EMPTY_DRAFT, type SessionDraft } from "../lib/draft-key.js";
import { draftWriter, loadDraftSnapshot } from "../lib/draft-snapshot.js";
import type { SkillCommand } from "../lib/skill-commands.js";
import {
  clearUndelivered,
  readUndelivered,
  rememberUndelivered,
} from "../lib/undelivered-store.js";

const TOOL_ACTIVITY_EXPANDED_STORAGE_KEY = "platform-tool-activity-expanded";

export type RewriteMode = "rewind" | "fork";

export interface ReportedCommands {
  sessionId: string;
  commands: SkillCommand[];
}

export type ChatRequest =
  | { kind: "open"; sessionId: string; mode: SessionMode | null }
  | { kind: "new" };

export interface Rewriting {
  messageId: string;
  mode: RewriteMode;
}

export interface PendingRewrite {
  sessionId: string;
  takeBack: boolean;
}

export interface SessionError {
  sessionId: string;
  kind: SessionFailureKind;
}

export interface SessionAttribution {
  senders: PlatformSenderEntry[];
  verdicts: PlatformVerdict[];
  turnSender: Sender | null;
}

export const NO_ATTRIBUTION: SessionAttribution = {
  senders: [],
  verdicts: [],
  turnSender: null,
};

export interface SessionsSlice {
  sessionId: string | null;
  sessionMode: SessionMode | null;
  messages: Message[];
  runStarts: string[];
  lastOutputAt: string | null;
  attribution: SessionAttribution;
  continuedFrom: PlatformContinuedFrom | null;
  queuedPrompts: QueuedPrompt[];
  reportedCommands: ReportedCommands | null;
  harnessForks: boolean;
  sessionSteering: SessionSteering | null;
  rewriting: Rewriting | null;
  rewritePending: PendingRewrite | null;
  nextSessionPair: Record<string, SessionPair>;
  nextTerminalPair: Record<string, SessionPair | null>;
  sessionError: SessionError | null;
  sessionFilter: SessionCategory[];
  drafts: Record<string, SessionDraft>;
  busy: boolean;
  terminalPaused: boolean;
  pendingResumeSessionId: string | null;
  pendingResumeSessionMode: SessionMode | null;
  pendingResumeFresh: boolean;
  chatRequest: ChatRequest | null;
  newSessionAgent: string | null;
  toolActivityExpanded: boolean;

  setSessionId: (id: string | null) => void;
  setPendingResumeSessionId: (
    id: string | null,
    mode?: SessionMode | null,
  ) => void;
  setSessionMode: (mode: SessionMode | null) => void;
  setTerminalPaused: (paused: boolean) => void;
  requestChat: (request: ChatRequest | null) => void;
  markNewSession: (agentId: string | null) => void;
  setToolActivityExpanded: (expanded: boolean) => void;
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  setRunStarts: (list: string[]) => void;
  setLastOutputAt: (at: string | null) => void;
  setAttribution: (attribution: SessionAttribution) => void;
  addSender: (entry: PlatformSenderEntry) => void;
  addVerdict: (verdict: PlatformVerdict) => void;
  setTurnSender: (sender: Sender | null) => void;
  setContinuedFrom: (copy: PlatformContinuedFrom | null) => void;
  setQueuedPrompts: (items: QueuedPrompt[]) => void;
  setReportedCommands: (sessionId: string, commands: SkillCommand[]) => void;
  setHarnessForks: (forks: boolean) => void;
  setSessionSteering: (steering: SessionSteering | null) => void;
  setRewriting: (rewriting: Rewriting | null) => void;
  setRewritePending: (pending: PendingRewrite | null) => void;
  addRunStart: (at: string) => void;
  setNextSessionPair: (agentId: string, pair: SessionPair) => void;
  clearNextSessionPair: (agentId: string) => void;
  setNextTerminalPair: (agentId: string, pair: SessionPair | null) => void;
  setSessionError: (e: SessionError | null) => void;
  setDraft: (key: string, patch: Partial<SessionDraft>) => void;
  appendNewSessionDraft: (agentId: string, text: string) => void;
  continueInNewSessionDraft: (agentId: string, invocationId: string) => void;
  dropDraftContinuation: (agentId: string) => void;
  clearDraftContent: (key: string) => void;
  clearDraft: (key: string) => void;
  migrateDraft: (fromKey: string, toKey: string) => void;
  consumeDroppedAttachments: (key: string) => void;
  pruneDrafts: (agentId: string, liveSessionIds: readonly string[]) => void;
  clearAgentDrafts: (agentId: string) => void;
  applyForeignDraft: (key: string, draft: SessionDraft | null) => void;
  setBusy: (busy: boolean) => void;

  deleteSession: (sessionId: string, agentId?: string) => Promise<boolean>;
  reopenUnstoredSession: (
    sessionId: string,
    undelivered: PlatformUndeliveredPrompt[],
  ) => Promise<void>;
  discardSessionToDraft: (sessionId: string, text: string) => Promise<void>;

  resetChatContext: () => void;
  confirmDockDiscard: () => Promise<boolean>;
  leaveChatContext: (navigate: () => void) => void;
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
    const before = get().drafts;
    const drafts = { ...before };
    if (!recipe(drafts)) return;
    set({ drafts });
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(drafts),
    ])) {
      if (before[key] === drafts[key]) continue;
      draftWriter.write(key, drafts[key] ?? null);
    }
  };

  const openDraftKey = (): string | null => {
    const agentId = get().selectedAgent;
    return agentId === null ? null : draftKey(agentId, get().sessionId);
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

  const forgetSession = async (agentId: string, sessionId: string) => {
    if (get().sessionId === sessionId) get().resetChatContext();
    await queryClient.cancelQueries({
      queryKey: acpSessionsKeys.agent(agentId),
    });
    removeSessionFromCache(agentId, sessionId);
    get().clearDraft(draftKey(agentId, sessionId));
    queryClient.invalidateQueries({
      queryKey: acpSessionsKeys.agent(agentId),
    });
  };

  return {
    sessionId: null,
    runStarts: [],
    lastOutputAt: null,
    attribution: NO_ATTRIBUTION,
    continuedFrom: null,
    queuedPrompts: [],
    reportedCommands: null,
    harnessForks: false,
    sessionSteering: null,
    rewriting: null,
    rewritePending: null,
    nextSessionPair: {},
    nextTerminalPair: {},
    sessionMode: null,
    messages: [],
    sessionError: null,
    sessionFilter: [...SESSION_CATEGORIES],
    drafts: loadDraftSnapshot(),
    busy: false,
    terminalPaused: false,
    pendingResumeSessionId: null,
    pendingResumeSessionMode: null,
    pendingResumeFresh: false,
    chatRequest: null,
    newSessionAgent: null,
    toolActivityExpanded: readPersistedFlag(
      TOOL_ACTIVITY_EXPANDED_STORAGE_KEY,
      false,
    ),

    setSessionId: (id) => set({ sessionId: id }),
    setPendingResumeSessionId: (id, mode = null) =>
      set({
        pendingResumeSessionId: id,
        pendingResumeSessionMode: mode,
        pendingResumeFresh: false,
      }),
    setSessionMode: (mode) => set({ sessionMode: mode }),
    setTerminalPaused: (paused) => set({ terminalPaused: paused }),
    requestChat: (request) => set({ chatRequest: request }),
    markNewSession: (agentId) => set({ newSessionAgent: agentId }),
    setToolActivityExpanded: (expanded) => {
      writePersistedFlag(TOOL_ACTIVITY_EXPANDED_STORAGE_KEY, expanded);
      set({ toolActivityExpanded: expanded });
    },
    setMessages: (updater) =>
      set((s) => ({
        messages: typeof updater === "function" ? updater(s.messages) : updater,
      })),
    setRunStarts: (list) => set({ runStarts: list }),
    setLastOutputAt: (at) => set({ lastOutputAt: at }),
    setAttribution: (attribution) => set({ attribution }),
    addSender: (entry) =>
      set((s) => ({
        attribution: {
          ...s.attribution,
          senders: [...s.attribution.senders, entry],
        },
      })),
    addVerdict: (verdict) =>
      set((s) => ({
        attribution: {
          ...s.attribution,
          verdicts: [
            ...s.attribution.verdicts.filter(
              (v) => v.toolCallId !== verdict.toolCallId,
            ),
            verdict,
          ],
        },
      })),
    setTurnSender: (sender) =>
      set((s) => ({ attribution: { ...s.attribution, turnSender: sender } })),
    setContinuedFrom: (copy) => set({ continuedFrom: copy }),
    setQueuedPrompts: (items) => set({ queuedPrompts: items }),
    setReportedCommands: (sessionId, commands) =>
      set({ reportedCommands: { sessionId, commands } }),
    setHarnessForks: (forks) => set({ harnessForks: forks }),
    setSessionSteering: (steering) => set({ sessionSteering: steering }),
    setRewriting: (rewriting) => set({ rewriting }),
    setRewritePending: (pending) => set({ rewritePending: pending }),
    setNextSessionPair: (agentId, pair) =>
      set((state) => ({
        nextSessionPair: { ...state.nextSessionPair, [agentId]: pair },
      })),
    clearNextSessionPair: (agentId) =>
      set((state) => ({
        nextSessionPair: Object.fromEntries(
          Object.entries(state.nextSessionPair).filter(
            ([id]) => id !== agentId,
          ),
        ),
      })),
    setNextTerminalPair: (agentId, pair) =>
      set((state) => ({
        nextTerminalPair: { ...state.nextTerminalPair, [agentId]: pair },
      })),
    addRunStart: (at) =>
      set((s) =>
        s.runStarts.includes(at) ? s : { runStarts: [...s.runStarts, at] },
      ),
    setSessionError: (e) => set({ sessionError: e }),
    setDraft: (key, patch) =>
      updateDrafts((drafts) => {
        const next = { ...(drafts[key] ?? EMPTY_DRAFT), ...patch };
        const empty =
          next.text.length === 0 &&
          next.attachments.length === 0 &&
          !next.droppedAttachmentNames?.length &&
          next.continuesInvocation === undefined;
        if (empty && !(key in drafts)) return false;
        if (empty) delete drafts[key];
        else drafts[key] = next;
        return true;
      }),
    appendNewSessionDraft: (agentId, text) =>
      updateDrafts((drafts) => {
        const key = draftKey(agentId, null);
        const current = drafts[key] ?? EMPTY_DRAFT;
        drafts[key] = {
          ...current,
          text: current.text.length > 0 ? `${current.text}\n\n${text}` : text,
        };
        return true;
      }),
    continueInNewSessionDraft: (agentId, invocationId) =>
      updateDrafts((drafts) => {
        const key = draftKey(agentId, null);
        drafts[key] = {
          ...(drafts[key] ?? EMPTY_DRAFT),
          continuesInvocation: invocationId,
        };
        return true;
      }),
    dropDraftContinuation: (agentId) =>
      get().setDraft(draftKey(agentId, null), {
        continuesInvocation: undefined,
      }),
    clearDraftContent: (key) =>
      get().setDraft(key, {
        text: "",
        attachments: [],
        droppedAttachmentNames: undefined,
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
    applyForeignDraft: (key, draft) => {
      if (key === openDraftKey()) return;
      const drafts = { ...get().drafts };
      if (draft === null) {
        if (!(key in drafts)) return;
        delete drafts[key];
      } else {
        drafts[key] = draft;
      }
      set({ drafts });
    },
    setBusy: (busy) => set({ busy }),

    resetChatContext: () =>
      set({
        sessionId: null,
        sessionMode: null,
        messages: [],
        runStarts: [],
        lastOutputAt: null,
        attribution: NO_ATTRIBUTION,
        continuedFrom: null,
        queuedPrompts: [],
        reportedCommands: null,
        rewriting: null,
        rewritePending: null,
        sessionError: null,
        terminalPaused: false,
        dock: null,
        openFileDirty: false,
        openArtifactDirty: false,
        openFileEdit: false,
        pendingPermissions: [],
        pendingResumeSessionId: null,
        chatRequest: null,
      }),

    confirmDockDiscard: async () => {
      const { openArtifactDirty, openFileDirty, showConfirm } = get();
      if (!openArtifactDirty && !openFileDirty) return true;
      return showConfirm("Your edits are lost.", "Discard unsaved changes?", {
        kind: "destructive",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
    },

    leaveChatContext: (navigate) => {
      const leave = () => {
        get().resetChatContext();
        navigate();
      };
      const { openArtifactDirty, openFileDirty } = get();
      if (!openArtifactDirty && !openFileDirty) return leave();
      void get()
        .confirmDockDiscard()
        .then((ok) => {
          if (ok) leave();
        });
    },

    deleteSession: async (
      sessionId,
      agentId = get().selectedAgent ?? undefined,
    ) => {
      if (!agentId) return false;
      const ok = await runAction(
        () => deleteAgentSession(agentId, sessionId),
        "Failed to delete session",
      );
      if (ok === ACTION_FAILED) return false;
      await forgetSession(agentId, sessionId);
      emitToast({ kind: "success", message: "Session deleted" });
      return true;
    },

    reopenUnstoredSession: async (sessionId, undelivered) => {
      const agentId = get().selectedAgent;
      if (!agentId) return;
      const own = draftKey(agentId, sessionId);
      const prompts = [...readUndelivered(own), ...undelivered];
      for (const prompt of prompts)
        rememberUndelivered(draftKey(agentId, null), prompt);
      clearUndelivered(own);
      await deleteAgentSession(agentId, sessionId).catch(() => {});
      await forgetSession(agentId, sessionId);
      emitToast({
        kind: "info",
        message:
          prompts.length > 0
            ? "The agent stopped before it saved this conversation. Your message is back in a new chat."
            : "The agent stopped before it saved this conversation, so it was removed.",
      });
    },

    discardSessionToDraft: async (sessionId, text) => {
      const agentId = get().selectedAgent;
      if (!agentId) return;
      const continuation =
        get().sessionId === sessionId
          ? get().continuedFrom?.invocationId
          : undefined;
      await deleteAgentSession(agentId, sessionId);
      await forgetSession(agentId, sessionId);
      get().appendNewSessionDraft(agentId, text);
      if (continuation) get().continueInNewSessionDraft(agentId, continuation);
    },
  };
};
