import { useStore } from "../../../store.js";
import { useWakeAgentMutation } from "../api/mutations.js";

/**
 * Wraps the raw wake mutation with the optimistic "coming up" lifecycle so the
 * overlay/pill flips to "Starting" the instant the user clicks Start, instead
 * of waiting for the next state poll. Reuses the same optimistic bridge as
 * useRestartAgent — a wake is just another optimistic transition to running,
 * and it ages out the same way (the hibernated state is the non-running dip).
 */
export function useWakeAgent() {
  const setRestarting = useStore((s) => s.setRestartingAgent);
  const clearRestarting = useStore((s) => s.clearRestartingAgent);
  const wakeMutation = useWakeAgentMutation();

  const wake = (id: string) => {
    setRestarting(id, { seenNonRunning: false, clickedAt: Date.now() });
    wakeMutation.mutate({ id }, { onError: () => clearRestarting(id) });
  };

  return { wake, isPending: wakeMutation.isPending };
}
