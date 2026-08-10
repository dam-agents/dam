import { useEffect, useRef } from "react";

import { useAgentsList } from "../api/queries.js";
import { useWakeAgent } from "./use-wake-agent.js";

export function useAutoWakeOnOpen(agentId: string | null): void {
  const agents = useAgentsList();
  const { wake } = useWakeAgent();
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (!agentId || attempted.current.has(agentId)) return;
    const agent = agents.find((a) => a.id === agentId);
    if (!agent || agent.state !== "hibernated" || agent.overBudget) return;
    attempted.current.add(agentId);
    wake(agentId);
  }, [agentId, agents, wake]);
}
