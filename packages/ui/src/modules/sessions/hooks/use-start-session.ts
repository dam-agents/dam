import { useCallback } from "react";

import { useStore } from "../../../store.js";

export function useStartSession() {
  const openAgentId = useStore((s) =>
    s.view === "chat" ? s.selectedAgent : null,
  );
  const requestChat = useStore((s) => s.requestChat);
  const selectAgent = useStore((s) => s.selectAgent);

  return useCallback(
    (agentId: string) => {
      if (agentId === openAgentId) requestChat({ kind: "new" });
      else selectAgent(agentId);
    },
    [openAgentId, requestChat, selectAgent],
  );
}
