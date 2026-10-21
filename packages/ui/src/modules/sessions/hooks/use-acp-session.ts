import { CONFIGURE_SESSION_METHOD, PIN_MODEL_METHOD } from "agent-runtime-api";
import {
  type DefaultKind,
  type PromptBlock,
  SessionMode,
} from "api-server-api";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import type { Attachment, MessagePart } from "../../../types.js";
import { connectionWentAway } from "../../acp/close-race.js";
import {
  classifyResumeError,
  extractErrorMessage,
  resumeFailureKind,
  type SessionFailureKind,
  type SessionListing,
  unstoredSessionPrompts,
} from "../../acp/errors.js";
import { framesToMessages } from "../../acp/frames-to-messages.js";
import {
  appendUndelivered,
  finalizeAllStreaming,
  hasStreamingAssistant,
} from "../../acp/session-projection.js";
import {
  untilAgentOperable,
  useAgentRunState,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { askAgainWhenReady } from "../../agents/lib/agent-start.js";
import { findAgentSession } from "../api/acp-session-ops.js";
import { acpSessionsKeys } from "../api/keys.js";
import {
  fetchSessionHistory,
  listedSessionRunning,
  SESSION_HISTORY_TAIL,
  setSessionRunning,
} from "../api/queries.js";
import { draftKey } from "../lib/draft-key.js";
import { createPromptDelivery } from "../lib/prompt-delivery.js";
import { rewrittenThread } from "../lib/rewrite-messages.js";
import { readUndelivered } from "../lib/undelivered-store.js";
import type { RewriteMode } from "../store/sessions.js";
import { useAcpConnection } from "./use-acp-connection.js";
import { type SendPromptOptions, useAcpPrompt } from "./use-acp-prompt.js";
import { useAcpSessionEngagement } from "./use-acp-session-engagement.js";
import { useAcpUpdateHandler } from "./use-acp-update-handler.js";
import { useTakeBackPrompt } from "./use-take-back-prompt.js";

async function classifyResumeFailure(
  agentId: string,
  sid: string,
  e: unknown,
): Promise<SessionFailureKind> {
  const kind = classifyResumeError(e);
  if (kind === "connection") return kind;
  let listing: SessionListing = "unknown";
  try {
    listing = (await findAgentSession(agentId, sid)) ? "listed" : "absent";
  } catch {}
  return resumeFailureKind(kind, listing);
}

const GONE_AWAY_RETRY_DELAYS_MS = [500, 1_000, 2_000];

async function retryWhileGoneAway<T>(
  load: () => Promise<T>,
  wanted: () => boolean,
): Promise<T> {
  for (const delay of GONE_AWAY_RETRY_DELAYS_MS) {
    try {
      return await load();
    } catch (e) {
      if (!connectionWentAway(e)) throw e;
      await new Promise((r) => setTimeout(r, delay));
      if (!wanted()) throw e;
    }
  }
  return load();
}

export function useAcpSession(
  selectedAgent: string | null,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
) {
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const messages = useStore((s) => s.messages);
  const queueWaiting = useStore((s) => s.queuedPrompts.length > 0);
  const setSessionId = useStore((s) => s.setSessionId);
  const setMessages = useStore((s) => s.setMessages);
  const setBusy = useStore((s) => s.setBusy);
  const [loadingSession, setLoadingSession] = useState(false);

  const busy =
    sessionMode !== SessionMode.Terminal &&
    (hasStreamingAssistant(messages) || queueWaiting);
  useEffect(() => {
    setBusy(busy);
  }, [busy, setBusy]);
  const prevBusyRef = useRef(busy);
  useEffect(() => {
    if (prevBusyRef.current === busy) return;
    prevBusyRef.current = busy;
    if (selectedAgent && sessionId) {
      setSessionRunning(selectedAgent, sessionId, busy);
    }
  }, [busy, selectedAgent, sessionId]);

  const agentOperable = useIsAgentOperable(selectedAgent);

  const {
    engagedSessionIdRef,
    engage,
    bind: bindEngagement,
    clear: clearEngagement,
  } = useAcpSessionEngagement(selectedAgent);

  const [delivery] = useState(createPromptDelivery);

  const reloadAfterResetRef = useRef<(sessionId: string) => void>(() => {});
  const onSessionReset = useCallback(
    (sid: string) => reloadAfterResetRef.current(sid),
    [],
  );
  const makeUpdateHandler = useAcpUpdateHandler(onSessionReset);

  const {
    ensureLive,
    beginSession,
    loadSessionHistory,
    runtimeIdle,
    clearRuntimeIdle,
    connectionRef,
    state: connectionState,
    reset: resetConnection,
  } = useAcpConnection({
    selectedAgent,
    sessionId,
    sessionMode,
    liveBlocked: loadingSession,
    agentOperable,
    makeUpdateHandler,
    engage,
    bindEngagement,
    clearEngagement,
    setMessages,
    delivery,
  });

  useLayoutEffect(() => {
    if (!sessionId || !runtimeIdle(sessionId)) return;
    if (!hasStreamingAssistant(useStore.getState().messages)) return;
    setMessages((p) => finalizeAllStreaming(p));
  }, [sessionId, messages, runtimeIdle, setMessages]);

  useEffect(() => {
    if (!selectedAgent || sessionId !== null) return;
    if (useStore.getState().messages.length > 0) return;
    const held = readUndelivered(draftKey(selectedAgent, null));
    if (held.length > 0) setMessages(appendUndelivered([], held));
  }, [selectedAgent, sessionId, setMessages]);

  const resetSession = useCallback(() => {
    resetConnection();
    setSessionId(null);
    setMessages(
      selectedAgent === null
        ? []
        : appendUndelivered([], readUndelivered(draftKey(selectedAgent, null))),
    );
    useStore.getState().setRunStarts([]);
    useStore.getState().setContinuedFrom(null);
    useStore.getState().setSessionError(null);
  }, [resetConnection, setSessionId, setMessages, selectedAgent]);

  const resumeSession = useCallback(
    async (sid: string) => {
      if (!selectedAgent) return;

      resetConnection();
      setLoadingSession(true);
      setMessages([]);
      useStore.getState().setRewriting(null);
      useStore.getState().setRunStarts([]);
      useStore.getState().setContinuedFrom(null);
      useStore.getState().setSessionError(null);
      setSessionId(sid);

      let loaded = false;
      const hold = agentOperable ? null : untilAgentOperable(selectedAgent);
      hold?.catch(() => {});
      if (agentOperable || hold) {
        askAgainWhenReady(
          async () => (loaded ? null : fetchSessionHistory(selectedAgent, sid)),
          () => hold,
        )
          .then((frames) => {
            if (!frames || loaded || useStore.getState().sessionId !== sid)
              return;
            const preview = framesToMessages(frames, {
              tail: SESSION_HISTORY_TAIL,
              turnInFlight: listedSessionRunning(selectedAgent, sid),
            });
            if (preview.length > 0) setMessages(preview);
          })
          .catch(() => {});
      }

      try {
        const fresh = await retryWhileGoneAway(
          () => loadSessionHistory(sid),
          () => useStore.getState().sessionId === sid,
        ).finally(() => {
          loaded = true;
        });
        if (useStore.getState().sessionId !== sid) return;
        setMessages(fresh);

        try {
          const match = await findAgentSession(selectedAgent, sid);
          if (match?.mode && match.mode !== useStore.getState().sessionMode) {
            useStore.getState().setSessionMode(match.mode);
          }
        } catch {}
      } catch (e) {
        if (useStore.getState().sessionId !== sid) return;
        const unstored = unstoredSessionPrompts(e);
        if (unstored !== null) {
          setLoadingSession(false);
          await useStore.getState().reopenUnstoredSession(sid, unstored);
          return;
        }
        setMessages([]);
        const kind = await classifyResumeFailure(selectedAgent, sid, e);
        if (useStore.getState().sessionId !== sid) return;
        useStore.getState().setSessionError({ sessionId: sid, kind });
      } finally {
        if (useStore.getState().sessionId === sid) setLoadingSession(false);
      }
    },
    [
      selectedAgent,
      agentOperable,
      loadSessionHistory,
      resetConnection,
      setMessages,
      setSessionId,
    ],
  );

  const loadOlderMessages = useCallback(
    async (before: string): Promise<"paged" | "reloaded" | "noop"> => {
      const sid = useStore.getState().sessionId;
      if (!sid) return "noop";
      try {
        const page = await loadSessionHistory(sid, before);
        if (useStore.getState().sessionId !== sid) return "noop";
        const current = useStore.getState().messages;
        setMessages([
          ...page,
          ...current.filter((m) => m.loadOlderBefore !== before),
        ]);
        return "paged";
      } catch {
        const fresh = await loadSessionHistory(sid).catch(() => null);
        if (fresh && useStore.getState().sessionId === sid) {
          setMessages(fresh);
          return "reloaded";
        }
        return "noop";
      }
    },
    [loadSessionHistory, setMessages],
  );

  const agentRunState = useAgentRunState(selectedAgent);
  const { sendPrompt: promptAgent, stopAgent } = useAcpPrompt({
    selectedAgent,
    agentRunState,
    ensureConnection: ensureLive,
    beginSession,
    engagedSessionIdRef,
    connectionRef,
    textareaRef,
    delivery,
  });

  const chooseSessionModel = useCallback(
    async (value: string, onPinned?: () => void) => {
      const sid = useStore.getState().sessionId;
      if (!sid || !selectedAgent) return;
      try {
        const live = connectionRef.current ?? (await ensureLive());
        if (!live) throw new Error("the agent is not connected");
        await live.connection.agent.request(PIN_MODEL_METHOD, {
          sessionId: sid,
          model: value,
          follows: null,
        });
        onPinned?.();
        await queryClient.invalidateQueries({
          queryKey: acpSessionsKeys.agent(selectedAgent),
        });
      } catch (err) {
        emitToast({
          kind: "error",
          message: `Couldn't switch this session's model: ${extractErrorMessage(err)}`,
        });
      }
    },
    [connectionRef, ensureLive, selectedAgent],
  );

  const configureSession = useCallback(
    async (
      settings: Record<string, string>,
      follows: DefaultKind | null = null,
      afterNextDefaults = false,
    ) => {
      const sid = useStore.getState().sessionId;
      if (!sid || !selectedAgent) return;
      try {
        const live = connectionRef.current ?? (await ensureLive());
        if (!live) throw new Error("the agent is not connected");
        await live.connection.agent.request(CONFIGURE_SESSION_METHOD, {
          sessionId: sid,
          settings,
          follows,
          ...(afterNextDefaults && { afterNextDefaults: true }),
        });
        await queryClient.invalidateQueries({
          queryKey: acpSessionsKeys.agent(selectedAgent),
        });
      } catch (err) {
        emitToast({
          kind: "error",
          message: `Couldn't change this session's settings: ${extractErrorMessage(err)}`,
        });
      }
    },
    [connectionRef, ensureLive, selectedAgent],
  );

  const rewriteFrom = useCallback(
    async (rewrite: {
      messageId: string;
      upToMessageId: string | null | undefined;
      mode: RewriteMode;
      text: string;
      title: string | null;
    }): Promise<void> => {
      if (!selectedAgent) return;
      const live = await ensureLive();
      if (!live) throw new Error("the agent is not connected");
      const all = useStore.getState().messages;
      const at = all.findIndex((m) => m.id === rewrite.messageId);
      if (at === -1) return;
      const parts = [
        ...all[at].parts.filter((p) => p.kind === "image"),
        { kind: "text" as const, text: rewrite.text },
      ];
      const promptId = crypto.randomUUID();
      useStore.getState().setRewritePending(live.sessionId);
      const result = (await live.connection.agent
        .request("platform/rewriteFrom", {
          sessionId: live.sessionId,
          mode: rewrite.mode,
          messageId: rewrite.messageId,
          ...(rewrite.upToMessageId !== undefined && {
            upToMessageId: rewrite.upToMessageId,
          }),
          prompt: promptBlocksOf(parts),
          promptId,
          ...(rewrite.title
            ? {
                title:
                  rewrite.mode === "fork"
                    ? `${rewrite.title} (fork)`
                    : rewrite.title,
              }
            : {}),
        })
        .finally(() => useStore.getState().setRewritePending(null))) as {
        sessionId: string;
      };
      setMessages((prev) => rewrittenThread(prev, at, promptId, parts));
      useStore.getState().setRewriting(null);
      if (result.sessionId !== live.sessionId) {
        bindEngagement(result.sessionId);
        setSessionId(result.sessionId);
      }
      void queryClient.invalidateQueries({
        queryKey: acpSessionsKeys.agent(selectedAgent),
      });
    },
    [selectedAgent, ensureLive, bindEngagement, setSessionId, setMessages],
  );

  reloadAfterResetRef.current = (sid: string) => {
    if (useStore.getState().sessionId === sid) void resumeSession(sid);
  };

  const takeBackPrompt = useTakeBackPrompt({
    selectedAgent,
    stopAgent,
    ensureLive,
    bindEngagement,
    reloadSession: resumeSession,
  });

  const sendPrompt = useCallback(
    (
      text: string,
      attachments?: Attachment[],
      opts?: SendPromptOptions,
    ): Promise<void> => {
      if (sessionId) clearRuntimeIdle(sessionId);
      return promptAgent(text, attachments, opts);
    },
    [sessionId, clearRuntimeIdle, promptAgent],
  );

  return {
    resetSession,
    resumeSession,
    loadOlderMessages,
    sendPrompt,
    rewriteFrom,
    takeBackPrompt,
    stopAgent,
    chooseSessionModel,
    configureSession,
    busy,
    loadingSession,
    connectionState,
  };
}

function promptBlocksOf(parts: MessagePart[]): PromptBlock[] {
  return parts.flatMap((p): PromptBlock[] =>
    p.kind === "image"
      ? [{ type: "image", data: p.data, mimeType: p.mimeType }]
      : p.kind === "text"
        ? [{ type: "text", text: p.text }]
        : [],
  );
}
