import type { LibraryArtifact } from "api-server-api";
import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useDeleteArtifact } from "../api/mutations.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one way to delete an artifact from a menu. It
 * asks first, because every version goes and the share link stops working.
 * It closes the docked preview of that artifact, and leaves the artifact's own
 * page for the Artifacts list, so no surface shows an artifact that is gone.
 */
export function useConfirmDeleteArtifact() {
  const showConfirm = useStore((s) => s.showConfirm);
  const openArtifactId = useStore((s) =>
    s.dock?.kind === "artifact" ? s.dock.id : null,
  );
  const setDock = useStore((s) => s.setDock);
  const pageArtifactId = useStore((s) =>
    s.view === "artifact" ? s.pageArtifactId : null,
  );
  const setView = useStore((s) => s.setView);
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
      deleteArtifact(
        { id: artifact.id },
        {
          onSuccess: () => {
            if (pageArtifactId === artifact.id) setView("artifacts");
          },
        },
      );
    },
    [
      showConfirm,
      openArtifactId,
      setDock,
      pageArtifactId,
      setView,
      deleteArtifact,
    ],
  );
}
