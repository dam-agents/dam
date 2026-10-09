import { useCallback } from "react";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";

export function useToggleProcessOutput() {
  const openKey = useStore((s) => s.openProcessOutputKey);
  const setOpenKey = useStore((s) => s.setOpenProcessOutputKey);
  const confirmDiscard = useDockDraftGuard();

  return useCallback(
    async (key: string | null) => {
      if (key !== null && key !== openKey && !(await confirmDiscard())) return;
      setOpenKey(key === openKey ? null : key);
    },
    [openKey, confirmDiscard, setOpenKey],
  );
}
