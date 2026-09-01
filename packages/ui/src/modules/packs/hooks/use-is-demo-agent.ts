import { useMemo } from "react";

import { useStore } from "../../../store.js";

export function useIsDemoAgent(agentId: string | null): boolean {
  const demoAgents = useStore((s) => s.demoAgents);
  return useMemo(() => {
    if (!agentId) return false;
    for (const id of demoAgents.values()) {
      if (id === agentId) return true;
    }
    return false;
  }, [agentId, demoAgents]);
}

export function useDemoPackId(agentId: string | null): string | null {
  const demoAgents = useStore((s) => s.demoAgents);
  return useMemo(() => {
    if (!agentId) return null;
    for (const [packId, id] of demoAgents) {
      if (id === agentId) return packId;
    }
    return null;
  }, [agentId, demoAgents]);
}
