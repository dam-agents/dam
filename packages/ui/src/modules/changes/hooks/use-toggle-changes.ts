import { useCallback } from "react";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";

export function useToggleChanges() {
  const setDock = useStore((s) => s.setDock);
  const confirmDiscard = useDockDraftGuard();

  return useCallback(
    async (agentId: string | null) => {
      if (agentId !== null && !(await confirmDiscard())) return;
      setDock(agentId === null ? null : { kind: "changes", agentId });
    },
    [confirmDiscard, setDock],
  );
}
