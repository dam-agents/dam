import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { hasStreamingAssistant } from "../../acp/session-projection.js";
import { classifyResumeError, extractErrorMessage } from "../../acp/utils.js";
import { useInstancesList } from "../../instances/api/queries.js";
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
  selectedInstance: string | null,
  selectedMcpServers: McpServer[],
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
) {
  const instances = useInstancesList();
  const sessionId = useStore((s) => s.sessionId);
  const messages = useStore((s) => s.messages);
  const setSessionId = useStore((s) => s.setSessionId);
  const setMessages = useStore((s) => s.setMessages);
  const setBusy = useStore((s) => s.setBusy);
  const [loadingSession, setLoadingSession] = useState(false);
  // resetSession clears the cached config alongside the engagement; the
  // engagement + capture paths use the config-cache hook.
  const setSessionModes = useStore((s) => s.setSessionModes);
  const setSessionModels = useStore((s) => s.setSessionModels);
  const setSessionConfigOptions = useStore((s) => s.setSessionConfigOptions);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const setSessionError = useStore((s) => s.setSessionError);

  // Derive busy from the projection instead of explicit setBusy calls in
  // sendPrompt / resume / disconnect paths. The projection owns streaming
  // state on every message, so "any streaming assistant" is authoritative.
  const busy = hasStreamingAssistant(messages);
  useEffect(() => { setBusy(busy); }, [busy, setBusy]);

  const instanceRunState = instances.find(i => i.id === selectedInstance)?.state;

  const { captureSessionConfig, handleConfigUpdate, applySavedPreferences } =
    useAcpConfigCache(selectedInstance, sessionId, instanceRunState);

  const { loadHistory } = useAcpHistory(
    selectedInstance,
    selectedMcpServers,
    captureSessionConfig,
    handleConfigUpdate,
  );

  const { engagedSessionIdRef, engage, clear: clearEngagement } = useAcpSessionEngagement(
    selectedInstance,
    selectedMcpServers,
    captureSessionConfig,
    applySavedPreferences,
  );

  const makeUpdateHandler = useAcpUpdateHandler(handleConfigUpdate);

  const { ensureLive, connectionRef, reset: resetConnection } = useAcpConnection({
    selectedInstance,
    sessionId,
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

  // Wake hibernated instance on entry.
  useEffect(() => {
    if (!selectedInstance) return;
    const inst = instances.find(({ id }) => id === selectedInstance);
    if (inst?.state === "hibernated") {
      api.instances.wake.mutate({ id: selectedInstance }).catch(() => {});
    }
  }, [selectedInstance, instances]);

  const resetSession = useCallback(() => {
    resetConnection();
    setSessionId(null);
    setMessages([]);
    setSessionModes(null);
    setSessionModels(null);
    setSessionConfigOptions([]);
  }, [resetConnection, setSessionId, setMessages, setSessionModes, setSessionModels, setSessionConfigOptions]);

  const resumeSession = useCallback(async (sid: string, opts?: { expectNotFound?: boolean }) => {
    if (!selectedInstance) return;

    resetConnection();
    setLoadingSession(true);
    setMessages([]);
    setSessionError(null);
    setSessionId(sid);
    setMobileScreen("chat");

    try {
      const fresh = await loadHistory(sid);
      if (useStore.getState().sessionId !== sid) return;
      setMessages(fresh);
    } catch (e) {
      if (useStore.getState().sessionId !== sid) return;
      const kind = classifyResumeError(e);
      if (kind === "not-found" && opts?.expectNotFound) {
        setLoadingSession(false);
        await api.sessions.delete.mutate({ sessionId: sid, instanceId: selectedInstance });
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
        resetSession();
        return;
      }
      setSessionError({
        sessionId: sid,
        message: extractErrorMessage(e),
        kind,
      });
    } finally {
      if (useStore.getState().sessionId === sid) setLoadingSession(false);
    }
  }, [selectedInstance, loadHistory, resetConnection, resetSession, setMessages, setSessionError, setSessionId, setMobileScreen]);

  const { sendPrompt, stopAgent } = useAcpPrompt(
    selectedInstance,
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
