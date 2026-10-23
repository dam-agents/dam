import { useCallback } from "react";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";

export function useToggleProcessOutput() {
  const openKey = useStore((s) =>
    s.dock?.kind === "process-output" ? s.dock.key : null,
  );
  const setDock = useStore((s) => s.setDock);
  const confirmDiscard = useDockDraftGuard();

  return useCallback(
    async (key: string | null) => {
      if (key !== null && key !== openKey && !(await confirmDiscard())) return;
      setDock(
        key === null || key === openKey
          ? null
          : { kind: "process-output", key },
      );
    },
    [openKey, confirmDiscard, setDock],
  );
}
