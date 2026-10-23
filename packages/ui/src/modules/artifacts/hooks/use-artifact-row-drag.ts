import type { DragEvent as ReactDragEvent } from "react";
import { useMemo } from "react";

export const ARTIFACT_MOVE_MIME = "application/x-platform-artifact-move";

interface ArtifactDragSource {
  id: string;
}

export interface ArtifactDragCallbacks {
  onStart: (folderId: string | null) => void;
  onEnd: () => void;
}

export interface FolderDropCallbacks extends ArtifactDragCallbacks {
  onEnter: (folderId: string | null) => void;
  onLeave: (folderId: string | null) => void;
  onDrop: (folderId: string | null, artifactId: string) => void;
}

export function hasArtifactMove(e: ReactDragEvent): boolean {
  return !!e.dataTransfer?.types?.includes(ARTIFACT_MOVE_MIME);
}

export function readArtifactMoveSource(
  e: ReactDragEvent,
): ArtifactDragSource | null {
  const raw = e.dataTransfer?.getData(ARTIFACT_MOVE_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ArtifactDragSource).id === "string"
    )
      return parsed as ArtifactDragSource;
  } catch {}
  return null;
}

export function useArtifactRowDrag(
  id: string,
  folderId: string | null,
  { onStart, onEnd }: ArtifactDragCallbacks,
) {
  return useMemo(
    () => ({
      draggable: true,
      onDragStart: (e: ReactDragEvent) => {
        e.dataTransfer.setData(ARTIFACT_MOVE_MIME, JSON.stringify({ id }));
        e.dataTransfer.effectAllowed = "move";
        onStart(folderId);
      },
      onDragEnd: () => onEnd(),
    }),
    [id, folderId, onStart, onEnd],
  );
}

export function useFolderDropTarget(
  folderId: string | null,
  { onEnter, onLeave, onDrop }: FolderDropCallbacks,
) {
  return useMemo(
    () => ({
      onDragEnter: (e: ReactDragEvent) => {
        if (!hasArtifactMove(e)) return;
        e.preventDefault();
        e.stopPropagation();
        onEnter(folderId);
      },
      onDragOver: (e: ReactDragEvent) => {
        if (!hasArtifactMove(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
      },
      onDragLeave: (e: ReactDragEvent) => {
        if (!hasArtifactMove(e)) return;
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onLeave(folderId);
      },
      onDrop: (e: ReactDragEvent) => {
        const source = readArtifactMoveSource(e);
        if (!source) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop(folderId, source.id);
      },
    }),
    [folderId, onEnter, onLeave, onDrop],
  );
}
