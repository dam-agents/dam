import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { useCallback, useEffect } from "react";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { hasStreamingAssistant } from "../../acp/session-projection.js";
import { classifyResumeError, extractErrorMessage } from "../../acp/utils.js";
import { useInstancesList } from "../../instances/api/queries.js";
import { acpSessionsKeys } from "../api/queries.js";
import { useAcpConfigCache } from "./use-acp-config-cache.js";
import { useAcpConnection } from "./use-acp-connection.js";
import { useAcpPrompt } from "./use-acp-prompt.js";
import { useAcpUpdateHandler } from "./use-acp-update-handler.js";

/**
 * Thin orchestrator: composes the connection, prompt, config-cache, and
 * update-handler hooks into the public surface that chat-view consumes.
 * Lifecycle decisions live in the connection hook; this file just wires
 * sub-hooks together and runs side effects that don't fit anywhere else
 * (wake-on-entry, busy-from-projection).
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

  const makeUpdateHandler = useAcpUpdateHandler(handleConfigUpdate);

  const {
    state: connectionState, ensureLive, connectionRef, engagedSessionIdRef, reset: resetConnection,
  } = useAcpConnection({
    selectedInstance, sessionId, selectedMcpServers,
    makeUpdateHandler, captureSessionConfig, handleConfigUpdate,
    applySavedPreferences, setMessages, setSessionId,
  });

  // The chat-view shows a "Loading session…" splash while history is
  // replaying. With load+live on a single channel, "loading" is exactly
  // the connection state — the connection hook is in `loading` while the
  // wrapper streams history through `loadSession`, then flips to `live`.
  const loadingSession = connectionState === "loading";

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
    setMessages([]);
    setSessionError(null);
    setSessionId(sid);
    setMobileScreen("chat");
    // ensureLive opens the load+live channel synchronously (state flips to
    // "loading" before React re-renders, avoiding a brief empty-session
    // flash). We await it so callers that opt into orphan cleanup — the
    // chat <-> terminal toggle — can intercept a not-found loadSession
    // before it would otherwise surface as an error card. The keepalive
    // effect's ensureLive() fires on the next render and shares this
    // promise via ensureInFlightRef.
    try {
      await ensureLive();
    } catch (err) {
      // Drop if the user has already navigated to a different session —
      // the error card would otherwise attach to the wrong session.
      if (useStore.getState().sessionId !== sid) return;
      const kind = classifyResumeError(err);
      if (kind === "not-found" && opts?.expectNotFound) {
        // Caller knew the session might not exist on the agent (e.g.
        // crossing back from terminal mode). Clean up the orphan DB row
        // and reset state silently instead of showing an error card.
        await api.sessions.delete.mutate({ sessionId: sid, instanceId: selectedInstance });
        queryClient.invalidateQueries({ queryKey: acpSessionsKeys.all });
        resetSession();
        return;
      }
      setSessionError({
        sessionId: sid,
        message: extractErrorMessage(err),
        kind,
      });
    }
  }, [selectedInstance, resetConnection, resetSession, setMessages, setSessionError, setSessionId, setMobileScreen, ensureLive]);

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
