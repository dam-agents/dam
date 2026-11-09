import type { LibraryArtifact } from "api-server-api";
import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useDeleteArtifact } from "../api/mutations.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one way to delete an artifact from a menu. It
 * asks first, because every version goes and the share link stops working,
 * and it closes the docked preview of that artifact, so the dock never shows
 * an artifact that is gone.
 */
export function useConfirmDeleteArtifact() {
  const showConfirm = useStore((s) => s.showConfirm);
  const openArtifactId = useStore((s) =>
    s.dock?.kind === "artifact" ? s.dock.id : null,
  );
  const setDock = useStore((s) => s.setDock);
  const { mutate: deleteArtifact } = useDeleteArtifact();

  return useCallback(
    async (artifact: LibraryArtifact) => {
      const confirmed = await showConfirm(
        "All versions are deleted and its share link stops working. This cannot be undone.",
        `Delete “${artifact.title}”?`,
        { kind: "destructive", confirmLabel: "Delete" },
      );
      if (!confirmed) return;

      if (openArtifactId === artifact.id) setDock(null);
      deleteArtifact({ id: artifact.id });
    },
    [showConfirm, openArtifactId, setDock, deleteArtifact],
  );
}
