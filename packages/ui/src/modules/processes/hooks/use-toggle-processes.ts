import { useCallback } from "react";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";

/** UNIT_BOUNDARY_DESCRIPTION: docks the Agent's processes beside the conversation, or takes them away, as the changes toggle does: opening them first asks to discard an unsaved file or artifact the dock holds. */
export function useToggleProcesses() {
  const setDock = useStore((s) => s.setDock);
  const confirmDiscard = useDockDraftGuard();
  return useCallback(
    async (agentId: string | null) => {
      if (agentId !== null && !(await confirmDiscard())) return;
      setDock(agentId === null ? null : { kind: "processes", agentId });
    },
    [confirmDiscard, setDock],
  );
}
