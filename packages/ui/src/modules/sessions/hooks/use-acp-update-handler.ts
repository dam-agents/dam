import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { applyUpdate } from "../../acp/session-projection.js";
import type { AcpUpdate, UpdateHandler } from "../../acp/types.js";
import type { PromptDelivery } from "./use-prompt-delivery.js";

/**
 * Build the streaming-update callback fed to `openConnection`. The handler:
 *   - drops any pending permission dialog whose tool call has moved past
 *     `pending` (another client answered, or the agent proceeded without one),
 *   - hands the runtime's prompt-delivery frames to the delivery state machine,
 *     which owns the send/content deadlines, and
 *   - feeds every notification through the pure projection to update messages.
 *
 * Returns a *factory* — `openConnection` wants a fresh handler per WS, so the
 * orchestrator calls `make()` at the connect site.
 */
export function useAcpUpdateHandler(
  delivery: PromptDelivery,
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
    return (update: AcpUpdate, sessionId: string) => {
      // Updates for a session no longer on screen must not reach the projection.
      // No session in the store isn't a mismatch — a session being created
      // streams its first updates before there is an id to commit.
      const viewing = useStore.getState().sessionId;
      if (viewing !== null && viewing !== sessionId) return;

      const { sessionUpdate: kind } = update;

      if (
        (kind === "tool_call" || kind === "tool_call_update") &&
        update.status &&
        update.status !== "pending"
      ) {
        dismissStalePermission(update.toolCallId);
      }

      delivery.handleUpdate(update);
      setMessages((prev) => applyUpdate(prev, update));
    };
  }, [delivery, dismissStalePermission, setMessages]);
}
