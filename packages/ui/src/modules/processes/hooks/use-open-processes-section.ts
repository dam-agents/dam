import { useCallback } from "react";

import { useStore } from "../../../store.js";

/** UNIT_BOUNDARY_DESCRIPTION: opens the Agent's processes docked beside the conversation, as the design's running count does. */
export function useOpenProcessesSection(agentId: string | null) {
  const setDock = useStore((s) => s.setDock);
  return useCallback(() => {
    if (agentId) setDock({ kind: "processes", agentId });
  }, [agentId, setDock]);
}
