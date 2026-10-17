import { useLayoutEffect, useRef } from "react";

import { useAgentsList } from "../api/queries.js";
import { nextAutoWake } from "../lib/auto-wake.js";
import { useWakeAgent } from "./use-wake-agent.js";

// UNIT_BOUNDARY_DESCRIPTION: the wake runs in a layout effect, so the agent already shows as starting in the first painted frame and the sleeping screen never flashes.
export function useAutoWakeOnOpen(agentId: string | null): void {
  const agents = useAgentsList();
  const { wake } = useWakeAgent();
  const decidedFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    const next = nextAutoWake(
      decidedFor.current,
      agentId,
      agents.find((a) => a.id === agentId),
    );
    decidedFor.current = next.decidedFor;
    if (next.wake && agentId) wake(agentId);
  }, [agentId, agents, wake]);
}
