import { useEffect, useRef } from "react";

import { useAgentsList } from "../api/queries.js";
import { useWakeAgent } from "./use-wake-agent.js";

const isMock = import.meta.env.VITE_MOCK === "true";

export function useAutoWakeOnOpen(agentId: string | null): void {
  const agents = useAgentsList();
  const { wake } = useWakeAgent();
  const decided = useRef(new Set<string>());

  useEffect(() => {
    if (isMock) return;
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
