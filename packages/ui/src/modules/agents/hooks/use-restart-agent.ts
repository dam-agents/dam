import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useRestartAgentMutation } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { transitionRestartingAgents } from "../store.js";

/**
 * Wraps the raw restart mutation with the UI-side "Restarting" pill lifecycle.
 * The pill goes on the moment the user clicks, ages out on the next poll that
 * sees the pod dip and then return, and gets cleared if the mutation itself
 * fails.
 */
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

/**
 * Advances the restartingAgents map whenever the agents query data
 * changes — mount this alongside useAgents in any view that renders the
 * "Restarting" pill so stuck/resolved entries age out correctly.
 */
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
