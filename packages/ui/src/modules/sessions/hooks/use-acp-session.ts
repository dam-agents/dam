import { SessionMode } from "api-server-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import {
  classifyResumeError,
  resumeFailureKind,
  type SessionFailureKind,
  type SessionListing,
} from "../../acp/errors.js";
import { hasStreamingAssistant } from "../../acp/session-projection.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { listAgentSessions, listSessionsOn } from "../api/acp-session-ops.js";
import { setSessionRunning } from "../api/queries.js";
import { useAcpConnection } from "./use-acp-connection.js";
import { useAcpPrompt } from "./use-acp-prompt.js";
import { useAcpSessionEngagement } from "./use-acp-session-engagement.js";
import { useAcpUpdateHandler } from "./use-acp-update-handler.js";
import { usePromptDelivery } from "./use-prompt-delivery.js";

async function classifyResumeFailure(
  agentId: string,
  sid: string,
  e: unknown,
): Promise<SessionFailureKind> {
  const kind = classifyResumeError(e);
  if (kind === "connection") return kind;
  let listing: SessionListing = "unknown";
  try {
    const sessions = await listAgentSessions(agentId);
    listing = sessions.some((s) => s.sessionId === sid) ? "listed" : "absent";
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

  const delivery = usePromptDelivery();

  const makeUpdateHandler = useAcpUpdateHandler(delivery);

  const {
    ensureLive,
    beginSession,
    loadSessionHistory,
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

  const resetSession = useCallback(() => {
    resetConnection();
    setSessionId(null);
    setMessages([]);
    useStore.getState().setSessionError(null);
  }, [resetConnection, setSessionId, setMessages]);

  const resumeSession = useCallback(
    async (sid: string) => {
      if (!selectedAgent) return;

      resetConnection();
      setLoadingSession(true);
      setMessages([]);
      useStore.getState().setSessionError(null);
      setSessionId(sid);

      try {
        const fresh = await loadSessionHistory(sid);
        if (useStore.getState().sessionId !== sid) return;
        setMessages(fresh);

        try {
          const conn = connectionRef.current?.connection;
          const sessions = conn
            ? await listSessionsOn(selectedAgent, conn)
            : await listAgentSessions(selectedAgent);
          const match = sessions.find((s) => s.sessionId === sid);
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
      connectionRef,
      resetConnection,
      setMessages,
      setSessionId,
    ],
  );

  const loadOlderMessages = useCallback(
    async (before: number): Promise<"paged" | "reloaded" | "noop"> => {
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

  const { sendPrompt, stopAgent } = useAcpPrompt({
    selectedAgent,
    ensureConnection: ensureLive,
    beginSession,
    engagedSessionIdRef,
    connectionRef,
    textareaRef,
    delivery,
  });

  return {
    resetSession,
    resumeSession,
    loadOlderMessages,
    sendPrompt,
    stopAgent,
    busy,
    loadingSession,
    connectionState,
  };
}
