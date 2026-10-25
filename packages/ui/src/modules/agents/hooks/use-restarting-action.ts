import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { findAgent, useAgents } from "../api/queries.js";

type AgentPowerMutate = (variables: { id: string }) => Promise<unknown>;

export function useRestartingAction(mutate: AgentPowerMutate) {
  const { data } = useAgents();
  const setRestarting = useStore((s) => s.setRestartingAgent);
  const clearRestarting = useStore((s) => s.clearRestartingAgent);

  return useCallback(
    (id: string) => {
      const agent = findAgent(data, id);
      setRestarting(id, {
        seenNonRunning: agent?.state !== "running",
        clickedAt: Date.now(),
        parkedAtClick: agent?.overBudget ?? false,
      });
      mutate({ id }).catch(() => clearRestarting(id));
    },
    [data, setRestarting, clearRestarting, mutate],
  );
}
