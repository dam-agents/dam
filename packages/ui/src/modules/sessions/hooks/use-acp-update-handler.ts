import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { applyUpdate } from "../../acp/session-projection.js";
import type { AcpUpdate, UpdateHandler } from "../../acp/types.js";

/**
 * Build the streaming-update callback fed to `openConnection`. The handler:
 *   - lets the config cache absorb mode/option updates,
 *   - drops any pending permission dialog whose tool call has moved past
 *     `pending` (another client answered, or the agent proceeded without one),
 *   - logs visible side effects (text/image chunks, tool-call starts), and
 *   - feeds every notification through the pure projection to update messages.
 *
 * Returns a *factory* — `openConnection` wants a fresh handler per WS, so the
 * orchestrator calls `make()` at the connect site.
 */
export function useAcpUpdateHandler(
  handleConfigUpdate: (update: AcpUpdate) => void,
): () => UpdateHandler {
  const setMessages = useStore((s) => s.setMessages);
  const addLog = useStore((s) => s.addLog);

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
      handleConfigUpdate(update);

      const { sessionUpdate: kind } = update;

      if (
        (kind === "tool_call" || kind === "tool_call_update") &&
        update.status &&
        update.status !== "pending"
      ) {
        dismissStalePermission(update.toolCallId);
      }

      if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
        const { content } = update;
        const logKind = kind === "agent_message_chunk" ? "text" : "thought";
        if (content.type === "text") addLog(logKind, { text: content.text });
        else if (content.type === "image" && kind === "agent_message_chunk") {
          addLog("image", { mimeType: content.mimeType });
        }
      } else if (kind === "tool_call") {
        const { title, status } = update;
        addLog("tool", { title, status });
      }

      setMessages((prev) => applyUpdate(prev, update));
    };
  }, [handleConfigUpdate, dismissStalePermission, addLog, setMessages]);
}
