import { useCallback } from "react";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one way to change which artifact the docked
 * panel holds. The panel is remounted per artifact, so swapping the id throws
 * away an unsaved draft — this asks first, over both dock slots, because
 * opening an artifact also evicts an open file. Re-opening the artifact already
 * held keeps that draft, because nothing is discarded.
 */
export function useOpenArtifact() {
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const confirmDiscard = useDockDraftGuard();

  return useCallback(
    async (id: string | null, opts?: { edit?: boolean }) => {
      if (id !== openArtifactId && !(await confirmDiscard())) return;
      setOpenArtifactId(id, opts);
    },
    [openArtifactId, confirmDiscard, setOpenArtifactId],
  );
}
