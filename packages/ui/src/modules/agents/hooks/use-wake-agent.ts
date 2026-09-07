import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useWakeAgentMutation } from "../api/mutations.js";
import { useAgentsList } from "../api/queries.js";

export function useWakeAgent() {
  const agents = useAgentsList();
  const setRestarting = useStore((s) => s.setRestartingAgent);
  const clearRestarting = useStore((s) => s.clearRestartingAgent);
  const { mutate, isPending } = useWakeAgentMutation();

  const wake = useCallback(
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

  return { wake, isPending };
}
