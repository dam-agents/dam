import { useCallback } from "react";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";

export function useToggleChanges() {
  const setOpenChanges = useStore((s) => s.setOpenChanges);
  const confirmDiscard = useDockDraftGuard();

  return useCallback(
    async (agentId: string | null) => {
      if (agentId !== null && !(await confirmDiscard())) return;
      setOpenChanges(agentId);
    },
    [confirmDiscard, setOpenChanges],
  );
}
