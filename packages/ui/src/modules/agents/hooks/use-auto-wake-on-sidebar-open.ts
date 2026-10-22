import { useLayoutEffect } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { nextAutoWake } from "../lib/auto-wake.js";
import { useWakeAgent } from "./use-wake-agent.js";

// UNIT_BOUNDARY_DESCRIPTION: an Agent's sidebar row wakes the Agent once each time its session list opens, whether the user or the page opened it. The open's decision lives in the store, not in the row, so a sidebar that mounts again (a move between a chat and Home, the mobile drawer's own copy) continues the open instead of starting one; closing the row ends the open, even while its list still slides closed.
export function useAutoWakeOnSidebarOpen(
  agent: AgentView,
  open: boolean,
): void {
  const { wake } = useWakeAgent();

  useLayoutEffect(() => {
    const s = useStore.getState();
    if (!open) {
      s.setSidebarWakeDecided(agent.id, false);
      return;
    }
    const next = nextAutoWake(
      s.sidebarWakeDecided.has(agent.id) ? agent.id : null,
      agent.id,
      agent,
      s.restartingAgents.has(agent.id),
    );
    s.setSidebarWakeDecided(agent.id, next.decidedFor === agent.id);
    if (next.wake) wake(agent.id);
  }, [agent, open, wake]);
}
