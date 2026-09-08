import { useCallback } from "react";

import { useStore } from "../../../store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one way to change which artifact the docked
 * panel holds. The panel is remounted per artifact, so swapping the id throws
 * away an unsaved draft — this asks first. Re-opening the artifact already
 * held keeps that draft, because nothing is discarded.
 */
export function useOpenArtifact() {
  const openArtifactId = useStore((s) => s.openArtifactId);
  const openArtifactDirty = useStore((s) => s.openArtifactDirty);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const showConfirm = useStore((s) => s.showConfirm);

  return useCallback(
    async (id: string | null, opts?: { edit?: boolean }) => {
      if (
        id !== openArtifactId &&
        openArtifactDirty &&
        !(await showConfirm("Discard unsaved changes?", "Unsaved changes"))
      )
        return;
      setOpenArtifactId(id, opts);
    },
    [openArtifactId, openArtifactDirty, showConfirm, setOpenArtifactId],
  );
}
