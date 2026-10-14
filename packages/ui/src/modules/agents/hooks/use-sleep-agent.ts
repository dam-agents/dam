import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useSleepAgentMutation } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { transitionFallingAsleepAgents } from "../store.js";

export function useSleepAgent() {
  const setFallingAsleep = useStore((s) => s.setFallingAsleepAgent);
  const clearFallingAsleep = useStore((s) => s.clearFallingAsleepAgent);
  const mutation = useSleepAgentMutation();

  return (id: string) => {
    setFallingAsleep(id, { clickedAt: Date.now() });
    mutation.mutateAsync({ id }).catch(() => clearFallingAsleep(id));
  };
}

export function useSyncFallingAsleepAgents() {
  const { data, dataUpdatedAt } = useAgents();
  const setFallingAsleepAgents = useStore((s) => s.setFallingAsleepAgents);

  useEffect(() => {
    if (!data) return;
    const current = useStore.getState().fallingAsleepAgents;
    const next = transitionFallingAsleepAgents(current, data.list);
    if (next !== current) setFallingAsleepAgents(next);
  }, [data, dataUpdatedAt, setFallingAsleepAgents]);
}
