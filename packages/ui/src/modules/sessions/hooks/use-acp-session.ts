import { SessionMode } from "api-server-api";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Attachment } from "../../../types.js";
import {
  classifyResumeError,
  resumeFailureKind,
  type SessionFailureKind,
  type SessionListing,
} from "../../acp/errors.js";
import {
  appendUndelivered,
  finalizeAllStreaming,
  hasStreamingAssistant,
} from "../../acp/session-projection.js";
import {
  useAgentRunState,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { findAgentSession } from "../api/acp-session-ops.js";
import { setSessionRunning } from "../api/queries.js";
import { draftKey } from "../lib/draft-key.js";
import { createPromptDelivery } from "../lib/prompt-delivery.js";
import { sessionModelFrom } from "../lib/session-model.js";
import { readUndelivered } from "../lib/undelivered-store.js";
import { useAcpConnection } from "./use-acp-connection.js";
import { type SendPromptOptions, useAcpPrompt } from "./use-acp-prompt.js";
import { useAcpSessionEngagement } from "./use-acp-session-engagement.js";
import { useAcpUpdateHandler } from "./use-acp-update-handler.js";

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

export function useAcpSession(
  selectedAgent: string | null,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
) {
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const messages = useStore((s) => s.messages);
  const setSessionId = useStore((s) => s.setSessionId);
  const setMessages = useStore((s) => s.setMessages);
  const setBusy = useStore((s) => s.setBusy);
  const [loadingSession, setLoadingSession] = useState(false);

  const busy =
    sessionMode !== SessionMode.Terminal && hasStreamingAssistant(messages);
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

  const makeUpdateHandler = useAcpUpdateHandler();

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
    useStore.getState().setSessionModel(null);
    useStore.getState().setSessionError(null);
  }, [resetConnection, setSessionId, setMessages, selectedAgent]);

  const resumeSession = useCallback(
    async (sid: string) => {
      if (!selectedAgent) return;

      resetConnection();
      setLoadingSession(true);
      setMessages([]);
      useStore.getState().setRunStarts([]);
      useStore.getState().setSessionModel(null);
      useStore.getState().setSessionError(null);
      setSessionId(sid);

      try {
        const fresh = await loadSessionHistory(sid);
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
        const kind = await classifyResumeFailure(selectedAgent, sid, e);
        if (useStore.getState().sessionId !== sid) return;
        useStore.getState().setSessionError({ sessionId: sid, kind });
      } finally {
        if (useStore.getState().sessionId === sid) setLoadingSession(false);
      }
    },
    [
      selectedAgent,
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
    async (value: string) => {
      const { sessionId: sid, sessionModel } = useStore.getState();
      if (!sid || sessionModel?.sessionId !== sid) return;
      try {
        const live = connectionRef.current ?? (await ensureLive());
        if (!live) throw new Error("the agent is not connected");
        const result = await live.connection.agent.request(
          "session/set_config_option",
          { sessionId: sid, configId: sessionModel.configId, value },
        );
        if (useStore.getState().sessionId !== sid) return;
        useStore
          .getState()
          .setSessionModel(sessionModelFrom(sid, result.configOptions));
      } catch (err) {
        emitToast({
          kind: "error",
          message: `Couldn't switch this session's model: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [connectionRef, ensureLive],
  );

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
    stopAgent,
    chooseSessionModel,
    busy,
    loadingSession,
    connectionState,
  };
}
