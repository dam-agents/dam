import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { usePauseAgent, useStopAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { transitionPausingAgents } from "../store.js";

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
