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
    return (update: AcpUpdate, sessionId: string) => {
      // A live WS can outlive the view that opened it — a send in flight while
      // the user clicks another session leaves this channel engaged to a
      // session that is no longer on screen. Its updates (including
      // `platform_turn_ended`, which would close a bubble that isn't its own)
      // must not reach the projection.
      //
      // No session in the store is *not* a mismatch: a session being created
      // streams its first updates between the runtime engaging this channel and
      // `session/new` returning an id to commit, and the blank chat those land
      // in is exactly the one the user is looking at.
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

      setMessages((prev) => applyUpdate(prev, update));
    };
  }, [dismissStalePermission, setMessages]);
}
