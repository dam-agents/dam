import { useCallback } from "react";

import { useStore } from "../../../store.js";

export function useStartSession() {
  const openAgentId = useStore((s) =>
    s.view === "chat" ? s.selectedAgent : null,
  );
  const requestChat = useStore((s) => s.requestChat);
  const selectAgent = useStore((s) => s.selectAgent);
  const markNewSession = useStore((s) => s.markNewSession);

  return useCallback(
    (agentId: string) => {
      markNewSession(agentId);
      if (agentId === openAgentId) requestChat({ kind: "new" });
      else selectAgent(agentId);
    },
    [openAgentId, requestChat, selectAgent, markNewSession],
  );
}
