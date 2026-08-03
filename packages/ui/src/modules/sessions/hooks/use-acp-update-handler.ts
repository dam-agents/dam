import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { applyUpdate } from "../../acp/session-projection.js";
import type { AcpUpdate, UpdateHandler } from "../../acp/types.js";

/**
 * Build the streaming-update callback fed to `openConnection`. The handler:
 *   - drops any pending permission dialog whose tool call has moved past
 *     `pending` (another client answered, or the agent proceeded without one), and
 *   - feeds every notification through the pure projection to update messages.
 *
 * Returns a *factory* — `openConnection` wants a fresh handler per WS, so the
 * orchestrator calls `make()` at the connect site.
 */
export function useAcpUpdateHandler(): () => UpdateHandler {
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
    return (update: AcpUpdate) => {
      const { sessionUpdate: kind } = update;

      if (
        (kind === "tool_call" || kind === "tool_call_update") &&
        update.status &&
        update.status !== "pending"
      ) {
        dismissStalePermission(update.toolCallId);
      }

      setMessages((prev) => applyUpdate(prev, update));
    };
  }, [dismissStalePermission, setMessages]);
}
