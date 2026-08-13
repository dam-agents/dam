import { useEffect, useRef } from "react";

import { useAgentsList } from "../api/queries.js";
import { useWakeAgent } from "./use-wake-agent.js";

export function useAutoWakeOnOpen(agentId: string | null): void {
  const agents = useAgentsList();
  const { wake } = useWakeAgent();
  const decided = useRef(new Set<string>());

  useEffect(() => {
    if (!agentId || decided.current.has(agentId)) return;
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    decided.current.add(agentId);
    if (
      agent.state === "hibernated" &&
      !agent.overBudget &&
      !agent.stopRequested
    )
      wake(agentId);
  }, [agentId, agents, wake]);
}
