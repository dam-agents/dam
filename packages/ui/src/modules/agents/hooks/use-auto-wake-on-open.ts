import { useLayoutEffect, useRef } from "react";

import { useAgentsList } from "../api/queries.js";
import { useWakeAgent } from "./use-wake-agent.js";

// UNIT_BOUNDARY_DESCRIPTION: opening the chat of a hibernated agent wakes it. The wake runs in a layout effect, so the agent already shows as starting in the first painted frame: the chat opens on a new session, and the hibernated overlay never flashes.
export function useAutoWakeOnOpen(agentId: string | null): void {
  const agents = useAgentsList();
  const { wake } = useWakeAgent();
  const decided = useRef(new Set<string>());

  useLayoutEffect(() => {
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
