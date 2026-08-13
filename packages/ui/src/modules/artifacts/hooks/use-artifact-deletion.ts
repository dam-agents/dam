import type { LibraryArtifact } from "api-server-api";
import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { useDeleteArtifact } from "../api/mutations.js";

export function useArtifactDeletion() {
  const showConfirm = useStore((s) => s.showConfirm);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const { mutate } = useDeleteArtifact();

  return useCallback(
    async (artifact: LibraryArtifact) => {
      const confirmed = await showConfirm(
        "All versions are deleted and its share link stops working. This cannot be undone.",
        `Delete “${artifact.title}”?`,
        { kind: "destructive", confirmLabel: "Delete" },
      );
      if (!confirmed) return;

      if (openArtifactId === artifact.id) setOpenArtifactId(null);
      mutate({ id: artifact.id });
    },
    [showConfirm, openArtifactId, setOpenArtifactId, mutate],
  );
}
