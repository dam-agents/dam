import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useAgentRunState } from "../api/queries.js";

export function useAgentReachability(agentId: string | null) {
  const runState = useAgentRunState(agentId);
  const unreachable = useStore((s) =>
    agentId ? s.unreachableAgents.has(agentId) : false,
  );
  const clearAgentUnreachable = useStore((s) => s.clearAgentUnreachable);

  useEffect(() => {
    if (agentId && unreachable && runState !== "running") {
      clearAgentUnreachable(agentId);
    }
  }, [agentId, unreachable, runState, clearAgentUnreachable]);
}
