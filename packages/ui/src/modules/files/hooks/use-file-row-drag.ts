import type { DragEvent as ReactDragEvent } from "react";
import { useMemo } from "react";

const INTERNAL_PREFIX = "filetree:";

interface RowDragCallbacks {
  onEnter: (targetDir: string) => void;
  onLeave: (targetDir: string) => void;
  onDrop: (targetDir: string, files: FileList) => void;
  onMoveDrop?: (targetDir: string, sourcePath: string) => void;
}

function hasFiles(e: ReactDragEvent): boolean {
  return !!e.dataTransfer?.types?.includes("Files");
}

function hasInternal(e: ReactDragEvent): boolean {
  return !!e.dataTransfer?.types?.includes("text/plain");
}

function hasDrag(e: ReactDragEvent): boolean {
  return hasFiles(e) || hasInternal(e);
}

export function useFileRowDrag(targetDir: string, callbacks: RowDragCallbacks) {
  const { onEnter, onLeave, onDrop, onMoveDrop } = callbacks;
  return useMemo(
    () => ({
      onDragEnter: (e: ReactDragEvent) => {
        if (!hasDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        onEnter(targetDir);
      },
      onDragOver: (e: ReactDragEvent) => {
        if (!hasDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasFiles(e) ? "copy" : "move";
      },
      onDragLeave: (e: ReactDragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onLeave(targetDir);
      },
      onDrop: (e: ReactDragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // External file drop
        if (e.dataTransfer?.files?.length) {
          onDrop(targetDir, e.dataTransfer.files);
          return;
        }

        // Internal tree move
        const raw = e.dataTransfer?.getData("text/plain") ?? "";
        if (raw.startsWith(INTERNAL_PREFIX) && onMoveDrop) {
          const sourcePath = raw.slice(INTERNAL_PREFIX.length);
          if (sourcePath !== targetDir && !targetDir.startsWith(sourcePath + "/")) {
            onMoveDrop(targetDir, sourcePath);
          }
        }
      },
    }),
    [targetDir, onEnter, onLeave, onDrop, onMoveDrop],
  );
}

export function makeDragStartProps(path: string) {
  return {
    draggable: true,
    onDragStart: (e: ReactDragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData("text/plain", INTERNAL_PREFIX + path);
      e.dataTransfer.effectAllowed = "move";
    },
  };
}
