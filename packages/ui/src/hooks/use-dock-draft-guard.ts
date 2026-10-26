import { useCallback } from "react";

import { useStore } from "../store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The docked slot beside a conversation holds either
 * an artifact or a sandbox file, never both — opening one evicts the other and
 * throws away whatever draft it held. Both lineages ask this before they swap,
 * so a draft dies only when its owner has said so, whichever surface displaced
 * it.
 */
export function useDockDraftGuard() {
  const openArtifactDirty = useStore((s) => s.openArtifactDirty);
  const openFileDirty = useStore((s) => s.openFileDirty);
  const showConfirm = useStore((s) => s.showConfirm);

  return useCallback(async () => {
    if (!openArtifactDirty && !openFileDirty) return true;
    return showConfirm("Discard unsaved changes?", "Unsaved changes");
  }, [openArtifactDirty, openFileDirty, showConfirm]);
}
