import { useCallback } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { forgetUndeliveredPrompt } from "../api/acp-session-ops.js";
import { draftKey } from "../lib/draft-key.js";
import { forgetUndelivered } from "../lib/undelivered-store.js";

export function useDeleteUndelivered(
  selectedAgent: string | null,
  sessionId: string | null,
): (id: string) => void {
  const setMessages = useStore((s) => s.setMessages);
  const showConfirm = useStore((s) => s.showConfirm);
  return useCallback(
    (id: string) => {
      void showConfirm(
        "Delete this message? It was never delivered to the agent, and its text cannot be recovered afterwards.",
        "Delete Message",
        { kind: "destructive" },
      ).then((confirmed) => {
        if (!confirmed) return;
        setMessages((prev) => prev.filter((m) => m.id !== id));
        if (!selectedAgent) return;
        forgetUndelivered(draftKey(selectedAgent, sessionId), id);
        if (sessionId) {
          forgetUndeliveredPrompt(selectedAgent, sessionId, id).catch(() => {
            emitToast({
              kind: "error",
              message:
                "Couldn't reach the agent to delete the message — it may come back on the next reload.",
            });
          });
        }
      });
    },
    [showConfirm, setMessages, selectedAgent, sessionId],
  );
}
