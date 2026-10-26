import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { useRestartAgentMutation } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { transitionRestartingAgents } from "../store.js";
import { useRestartingAction } from "./use-restarting-action.js";

export function useRestartAgent() {
  const { mutate, isPending } = useRestartAgentMutation();
  const restart = useRestartingAction(mutate);

  return { restart, isPending };
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
    const freshlyParked = data.list.find(
      (a) => a.overBudget && current.get(a.id)?.parkedAtClick === false,
    );
    if (freshlyParked) {
      const reason =
        freshlyParked.overBudgetMessage ?? "stop a running agent to free room";
      void showConfirm(
        `${reason[0].toUpperCase()}${reason.slice(1)}.`,
        "This agent could not start",
        { confirmLabel: "Manage sandboxes" },
      ).then((ok) => ok && setView("home"));
    }
  }, [data, dataUpdatedAt, setRestartingAgents, showConfirm, setView]);
}
