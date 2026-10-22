import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../api/queries.js";

type AgentPowerMutate = (variables: { id: string }) => Promise<unknown>;

export function useRestartingAction(mutate: AgentPowerMutate) {
  const agents = useAgentsList();
  const setRestarting = useStore((s) => s.setRestartingAgent);
  const clearRestarting = useStore((s) => s.clearRestartingAgent);

  return useCallback(
    (id: string) => {
      const agent = agents.find((a) => a.id === id);
      setRestarting(id, {
        seenNonRunning: agent?.state !== "running",
        clickedAt: Date.now(),
        parkedAtClick: agent?.overBudget ?? false,
      });
      mutate({ id }).catch(() => clearRestarting(id));
    },
    [agents, setRestarting, clearRestarting, mutate],
  );
}
