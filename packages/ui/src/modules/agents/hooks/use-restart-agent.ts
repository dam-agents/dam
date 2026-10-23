import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useRestartAgentMutation } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { transitionRestartingAgents } from "../store.js";

export function useRestartAgent() {
  const setRestarting = useStore((s) => s.setRestartingAgent);
  const clearRestarting = useStore((s) => s.clearRestartingAgent);
  const restartMutation = useRestartAgentMutation();

  const restart = (id: string) => {
    setRestarting(id, { seenNonRunning: false, clickedAt: Date.now() });
    restartMutation.mutate(
      { id },
      {
        onError: () => clearRestarting(id),
      },
    );
  };

  return { restart, isPending: restartMutation.isPending };
}

export function useSyncRestartingAgents() {
  const { data, dataUpdatedAt } = useAgents();
  const setRestartingAgents = useStore((s) => s.setRestartingAgents);

  useEffect(() => {
    if (!data) return;
    const current = useStore.getState().restartingAgents;
    const next = transitionRestartingAgents(current, data.list);
    if (next !== current) setRestartingAgents(next);
  }, [data, dataUpdatedAt, setRestartingAgents]);
}
