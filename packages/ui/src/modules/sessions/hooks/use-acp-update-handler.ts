import { useCallback } from "react";

import { useStore } from "../../../store.js";
import {
  applyUpdate,
  withoutQueuedSends,
} from "../../acp/session-projection.js";
import type { AcpUpdate, FrameMeta, UpdateHandler } from "../../acp/types.js";

export function useAcpUpdateHandler(
  onSessionReset: (sessionId: string) => void,
): () => UpdateHandler {
  const setMessages = useStore((s) => s.setMessages);

  const dismissStalePermission = useCallback(
    (toolCallId: string | undefined) => {
      if (!toolCallId) return;
      const pending = useStore.getState().pendingPermissions;
      if (pending.some((p) => p.toolCallId === toolCallId)) {
        useStore.getState().dismissPendingPermission(toolCallId);
      }
    },
    [],
  );

  return useCallback(() => {
    return (update: AcpUpdate, sessionId: string, frame?: FrameMeta) => {
      const viewing = useStore.getState().sessionId;
      if (viewing !== null && viewing !== sessionId) return;
      const pending = useStore.getState().rewritePending;
      const inFlight = pending?.sessionId === sessionId ? pending : null;

      const { sessionUpdate: kind } = update;

      if (
        (kind === "tool_call" || kind === "tool_call_update") &&
        update.status &&
        update.status !== "pending"
      ) {
        dismissStalePermission(update.toolCallId);
      }

      if (kind === "platform_run_started" && viewing === sessionId) {
        useStore.getState().addRunStart(update.at);
      }

      if (kind === "platform_sender_recorded") {
        useStore.getState().addSender(update.entry);
        return;
      }

      if (kind === "platform_turn_started") {
        useStore.getState().setTurnSender(update.sender ?? null);
        return;
      }

      if (kind === "platform_verdict_recorded") {
        useStore.getState().addVerdict(update.verdict);
        return;
      }

      if (kind === "platform_turn_ended")
        useStore.getState().setTurnSender(null);

      if (kind === "platform_session_reset") {
        if (!inFlight) onSessionReset(sessionId);
        return;
      }

      if (kind === "platform_queue_changed") {
        useStore.getState().setQueuedPrompts(update.items);
        setMessages((prev) => withoutQueuedSends(prev, update.items));
        return;
      }

      if (kind === "config_option_update") return;
      if (inFlight?.takeBack) return;

      setMessages((prev) => applyUpdate(prev, update, frame));
    };
  }, [dismissStalePermission, setMessages, onSessionReset]);
}
