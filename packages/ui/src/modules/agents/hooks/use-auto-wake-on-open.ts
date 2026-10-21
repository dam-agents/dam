import { useLayoutEffect, useRef } from "react";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../api/queries.js";
import { nextAutoWake } from "../lib/auto-wake.js";
import { useWakeAgent } from "./use-wake-agent.js";

// UNIT_BOUNDARY_DESCRIPTION: the wake runs in a layout effect, so the agent already shows as starting in the first painted frame and the sleeping screen never flashes. A wake already running when the open decides, from another view or a click, counts as the open's wake, so the chat and the sidebar opening together wake the agent once.
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
    if (
      next.wake &&
      agentId &&
      !useStore.getState().restartingAgents.has(agentId)
    )
      wake(agentId);
  }, [agentId, agents, wake]);
}
