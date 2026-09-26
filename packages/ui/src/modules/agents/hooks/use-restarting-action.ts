import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../api/queries.js";

type AgentPowerMutate = (
  variables: { id: string },
  options: { onError: () => void },
) => void;

export function useRestartingAction(mutate: AgentPowerMutate) {
  const agents = useAgentsList();
  const setRestarting = useStore((s) => s.setRestartingAgent);
  const clearRestarting = useStore((s) => s.clearRestartingAgent);

  return useCallback(
    (id: string) => {
      setRestarting(id, {
        seenNonRunning: false,
        clickedAt: Date.now(),
        parkedAtClick: agents.find((a) => a.id === id)?.overBudget ?? false,
      });
      mutate({ id }, { onError: () => clearRestarting(id) });
    },
    [agents, setRestarting, clearRestarting, mutate],
  );
}
