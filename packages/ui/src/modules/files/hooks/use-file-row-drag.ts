import type { DragEvent as ReactDragEvent } from "react";
import { useMemo } from "react";

/** DataTransfer type carrying an in-tree move (JSON DragSource). */
export const MOVE_MIME = "application/x-platform-move";

export interface DragSource {
  path: string;
  type: "file" | "dir";
}

interface RowDragCallbacks {
  onEnter: (targetDir: string) => void;
  onLeave: (targetDir: string) => void;
  onEnd: () => void;
  onDrop: (targetDir: string, files: FileList) => void;
  onMove: (targetDir: string, source: DragSource) => void;
}

function hasFiles(e: ReactDragEvent): boolean {
  return !!e.dataTransfer?.types?.includes("Files");
}

export function hasMove(e: ReactDragEvent): boolean {
  return !!e.dataTransfer?.types?.includes(MOVE_MIME);
}

export function readMoveSource(e: ReactDragEvent): DragSource | null {
  const raw = e.dataTransfer?.getData(MOVE_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as DragSource).path === "string" &&
      ((parsed as DragSource).type === "file" ||
        (parsed as DragSource).type === "dir")
    )
      return parsed as DragSource;
  } catch {
    // Foreign payload under our MIME type — ignore.
  }
  return null;
}

export function useFileRowDrag(
  targetDir: string,
  { path, type }: DragSource,
  callbacks: RowDragCallbacks,
) {
  const { onEnter, onLeave, onEnd, onDrop, onMove } = callbacks;
  return useMemo(
    () => ({
      draggable: true,
      onDragStart: (e: ReactDragEvent) => {
        e.dataTransfer.setData(MOVE_MIME, JSON.stringify({ path, type }));
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => onEnd(),
      onDragEnter: (e: ReactDragEvent) => {
        if (!hasFiles(e) && !hasMove(e)) return;
        e.preventDefault();
        e.stopPropagation();
        onEnter(targetDir);
      },
      onDragOver: (e: ReactDragEvent) => {
        if (!hasFiles(e) && !hasMove(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasMove(e) ? "move" : "copy";
      },
      onDragLeave: (e: ReactDragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onLeave(targetDir);
      },
      onDrop: (e: ReactDragEvent) => {
        const moved = readMoveSource(e);
        if (moved) {
          e.preventDefault();
          e.stopPropagation();
          onMove(targetDir, moved);
          return;
        }
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop(targetDir, e.dataTransfer.files);
      },
    }),
    [targetDir, path, type, onEnter, onLeave, onEnd, onDrop, onMove],
  );
}
