import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { applyUpdate } from "../../acp/session-projection.js";
import type { AcpUpdate, FrameMeta, UpdateHandler } from "../../acp/types.js";

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
    return (update: AcpUpdate, sessionId: string, frame?: FrameMeta) => {
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

      if (kind === "platform_run_started" && viewing === sessionId) {
        useStore.getState().addRunStart(update.at);
      }

      setMessages((prev) =>
        applyUpdate(prev, update, frame?.at, frame?.telemetryPromptId),
      );
    };
  }, [dismissStalePermission, setMessages]);
}
