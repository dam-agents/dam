import { useCallback, useEffect, useState } from "react";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { hasStreamingAssistant } from "../../acp/session-projection.js";
import { classifyResumeError, extractErrorMessage } from "../../acp/utils.js";
import { useAgentsList } from "../../agents/api/queries.js";
import {
  deleteAgentSession,
  listAgentSessions,
} from "../api/acp-session-ops.js";
import { acpSessionsKeys } from "../api/queries.js";
import { useAcpConfigCache } from "./use-acp-config-cache.js";
import { useAcpConnection } from "./use-acp-connection.js";
import { useAcpHistory } from "./use-acp-history.js";
import { useAcpPrompt } from "./use-acp-prompt.js";
import { useAcpSessionEngagement } from "./use-acp-session-engagement.js";
import { useAcpUpdateHandler } from "./use-acp-update-handler.js";

/**
 * Thin orchestrator: composes the connection, engagement, history, prompt,
 * config-cache, and update-handler hooks into the public surface that
 * chat-view consumes. Lifecycle decisions live in the sub-hooks; this file
 * just wires them up and runs the side effects that don't fit anywhere
 * else (wake-on-entry, busy-from-projection).
 */
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

  // Derive busy from the projection instead of explicit setBusy calls in
  // sendPrompt / resume / disconnect paths. The projection owns streaming
  // state on every message, so "any streaming assistant" is authoritative.
  const busy = hasStreamingAssistant(messages);
  useEffect(() => {
    setBusy(busy);
  }, [busy, setBusy]);

  const agentRunState = useAgentsList().find(
    (a) => a.id === selectedAgent,
  )?.state;

  const { captureSessionConfig, handleConfigUpdate, applySavedPreferences } =
    useAcpConfigCache(selectedAgent, sessionId, agentRunState);

  const { loadHistory } = useAcpHistory(
    selectedAgent,
    captureSessionConfig,
    handleConfigUpdate,
  );

  const {
    engagedSessionIdRef,
    engage,
    clear: clearEngagement,
  } = useAcpSessionEngagement(
    selectedAgent,
    captureSessionConfig,
    applySavedPreferences,
  );

  const makeUpdateHandler = useAcpUpdateHandler(handleConfigUpdate);

  const {
    ensureLive,
    connectionRef,
    reset: resetConnection,
  } = useAcpConnection({
    selectedAgent,
    sessionId,
    sessionMode,
    // Don't open a live WS while resumeSession's throwaway is still
    // replaying history — both channels would otherwise receive the replay
    // stream and the live projection would double-apply every update.
    liveBlocked: loadingSession,
    makeUpdateHandler,
    engage,
    clearEngagement,
    loadHistory,
    setMessages,
  });

  // Wake hibernated agent on entry.
  useEffect(() => {
    if (selectedAgent && agentRunState === "hibernated") {
      api.agents.wake.mutate({ id: selectedAgent }).catch(() => {});
    }
  }, [selectedAgent, agentRunState]);

  const resetSession = useCallback(() => {
    resetConnection();
    setSessionId(null);
    setMessages([]);
    const s = useStore.getState();
    s.setSessionModes(null);
    s.setSessionModels(null);
    s.setSessionConfigOptions([]);
  }, [resetConnection, setSessionId, setMessages]);

  const resumeSession = useCallback(
    async (sid: string, opts?: { expectNotFound?: boolean }) => {
      if (!selectedAgent) return;

      resetConnection();
      setLoadingSession(true);
      setMessages([]);
      useStore.getState().setSessionError(null);
      setSessionId(sid);

      try {
        const fresh = await loadHistory(sid);
        if (useStore.getState().sessionId !== sid) return;
        setMessages(fresh);

        try {
          const sessions = await listAgentSessions(selectedAgent);
          const match = sessions.find((s) => s.sessionId === sid);
          if (match?.mode && match.mode !== useStore.getState().sessionMode) {
            useStore.getState().setSessionMode(match.mode);
          }
        } catch {}
      } catch (e) {
        if (useStore.getState().sessionId !== sid) return;
        const kind = classifyResumeError(e);
        if (kind === "not-found" && opts?.expectNotFound) {
          setLoadingSession(false);
          await deleteAgentSession(selectedAgent, sid);
          queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
          resetSession();
          return;
        }
        useStore.getState().setSessionError({
          sessionId: sid,
          message: extractErrorMessage(e),
          kind,
        });
      } finally {
        if (useStore.getState().sessionId === sid) setLoadingSession(false);
      }
    },
    [
      selectedAgent,
      loadHistory,
      resetConnection,
      resetSession,
      setMessages,
      setSessionId,
    ],
  );

  const { sendPrompt, stopAgent } = useAcpPrompt(
    selectedAgent,
    ensureLive,
    engagedSessionIdRef,
    connectionRef,
    textareaRef,
  );

  return {
    connectionRef,
    /** Session id the live connection is currently bound to — exposed for
     *  SessionConfigBar's optimistic mutate paths. */
    engagedSessionIdRef,
    ensureConnection: ensureLive,
    resetSession,
    resumeSession,
    sendPrompt,
    stopAgent,
    busy,
    loadingSession,
  };
}
