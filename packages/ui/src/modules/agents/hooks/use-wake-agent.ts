import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useWakeAgentMutation } from "../api/mutations.js";

export function useWakeAgent() {
  const setRestarting = useStore((s) => s.setRestartingAgent);
  const clearRestarting = useStore((s) => s.clearRestartingAgent);
  const { mutate, isPending } = useWakeAgentMutation();

  const wake = useCallback(
    (id: string) => {
      setRestarting(id, { seenNonRunning: false, clickedAt: Date.now() });
      mutate({ id }, { onError: () => clearRestarting(id) });
    },
    [setRestarting, clearRestarting, mutate],
  );

  return { wake, isPending };
}
