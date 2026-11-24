import { useLayoutEffect, useRef } from "react";

import { useStore } from "../../../store.js";
import { useAgent } from "../api/queries.js";
import { nextOpenWake, NO_OPEN_WAKE } from "../lib/auto-wake.js";
import { usePageVisible } from "./use-page-visible.js";
import { useWakeAgent } from "./use-wake-agent.js";

// UNIT_BOUNDARY_DESCRIPTION: the wake runs in a layout effect, so the agent already shows as starting in the first painted frame and no frame without it flashes.
export function useAutoWakeOnOpen(agentId: string | null): void {
  const agent = useAgent(agentId);
  const { wake } = useWakeAgent();
  const memo = useRef(NO_OPEN_WAKE);
  const visible = usePageVisible();

  useLayoutEffect(() => {
    const next = nextOpenWake(
      memo.current,
      agentId,
      agent ?? undefined,
      !!agentId && useStore.getState().restartingAgents.has(agentId),
      visible,
    );
    memo.current = next.memo;
    if (next.wake && agentId) wake(agentId);
  }, [agentId, agent, wake, visible]);
}
