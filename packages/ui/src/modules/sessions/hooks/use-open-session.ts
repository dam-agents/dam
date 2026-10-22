import type { SessionMode } from "api-server-api";
import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { setSessionSeen } from "../api/queries.js";

export function useOpenSession() {
  const openAgentId = useStore((s) =>
    s.view === "chat" ? s.selectedAgent : null,
  );
  const requestChat = useStore((s) => s.requestChat);
  const openAgentSession = useStore((s) => s.openAgentSession);

  return useCallback(
    (agentId: string, sessionId: string, mode?: SessionMode | null) => {
      setSessionSeen(agentId, sessionId);
      if (agentId === openAgentId) {
        requestChat({ kind: "open", sessionId, mode: mode ?? null });
        return;
      }
      openAgentSession(agentId, sessionId, mode ?? undefined);
    },
    [openAgentId, requestChat, openAgentSession],
  );
}
