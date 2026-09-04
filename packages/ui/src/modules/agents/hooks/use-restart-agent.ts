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
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);

  useEffect(() => {
    if (!data) return;
    const current = useStore.getState().restartingAgents;
    const next = transitionRestartingAgents(current, data.list);
    if (next === current) return;
    setRestartingAgents(next);
    const freshlyParked = data.list.some(
      (a) => a.overBudget && current.get(a.id)?.parkedAtClick === false,
    );
    if (freshlyParked) {
      void showConfirm(
        "It looks like you've reached your usage limit for active agents. To start this agent, please hibernate some of your running sandboxes. You can manage your sandboxes by clicking the button below.",
        "You do not have enough usage slots to start this agent.",
        { confirmLabel: "Manage sandboxes" },
      ).then((ok) => ok && setView("coding-agents"));
    }
  }, [data, dataUpdatedAt, setRestartingAgents, showConfirm, setView]);
}
