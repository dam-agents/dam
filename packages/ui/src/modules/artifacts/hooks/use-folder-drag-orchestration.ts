import type { LibraryArtifact } from "api-server-api";
import { useMemo, useRef, useState } from "react";

import { useUpdateArtifact } from "../api/mutations.js";
import type { FolderDropCallbacks } from "./use-artifact-row-drag.js";

export function useFolderDragOrchestration(
  artifacts: readonly LibraryArtifact[],
): {
  dropCallbacks: FolderDropCallbacks;
  hotFolderId: string | null | undefined;
  dragInProgress: boolean;
} {
  const [hotFolderId, setHotFolderId] = useState<string | null | undefined>(
    undefined,
  );
  const [dragInProgress, setDragInProgress] = useState(false);
  const dragOriginId = useRef<string | null>(null);
  const moveArtifact = useUpdateArtifact().mutate;

  const dropCallbacks = useMemo<FolderDropCallbacks>(
    () => ({
      onStart: (folderId) => {
        dragOriginId.current = folderId;
        setDragInProgress(true);
      },
      onEnd: () => {
        dragOriginId.current = null;
        setDragInProgress(false);
        setHotFolderId(undefined);
      },
      onEnter: (folderId) =>
        setHotFolderId(
          folderId === dragOriginId.current ? undefined : folderId,
        ),
      onLeave: (folderId) =>
        setHotFolderId((hot) => (hot === folderId ? undefined : hot)),
      onDrop: (folderId, artifactId) => {
        setDragInProgress(false);
        setHotFolderId(undefined);
        const moved = artifacts.find((a) => a.id === artifactId);
        if (!moved || moved.folderId === folderId) return;
        moveArtifact({ id: artifactId, folderId });
      },
    }),
    [artifacts, moveArtifact],
  );

  return { dropCallbacks, hotFolderId, dragInProgress };
}
