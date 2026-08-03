import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { usePauseAgent, useStopAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { transitionPausingAgents } from "../store.js";

/**
 * Wraps Pause / Stop with the optimistic "Hibernating" pill lifecycle (mirrors
 * useRestartAgent). The pill goes on the moment the user clicks, ages out on
 * the next poll that sees the pod go down, and clears if the mutation fails.
 * Callers that need a confirm (Stop) run it before calling `stop`.
 */
export function useSuspendAgent() {
  const setPausing = useStore((s) => s.setPausingAgent);
  const clearPausing = useStore((s) => s.clearPausingAgent);
  const pauseMutation = usePauseAgent();
  const stopMutation = useStopAgent();

  const pause = (id: string) => {
    setPausing(id, { clickedAt: Date.now() });
    pauseMutation.mutate({ id }, { onError: () => clearPausing(id) });
  };
  const stop = (id: string) => {
    setPausing(id, { clickedAt: Date.now() });
    stopMutation.mutate({ id }, { onError: () => clearPausing(id) });
  };

  return { pause, stop };
}

/**
 * Advances the pausingAgents map whenever the agents query data changes —
 * mount alongside useAgents in any view that renders the pill so resolved
 * entries age out correctly.
 */
export function useSyncPausingAgents() {
  const { data, dataUpdatedAt } = useAgents();
  const setPausingAgents = useStore((s) => s.setPausingAgents);

  useEffect(() => {
    if (!data) return;
    const current = useStore.getState().pausingAgents;
    const next = transitionPausingAgents(current, data.list);
    if (next !== current) setPausingAgents(next);
  }, [data, dataUpdatedAt, setPausingAgents]);
}
