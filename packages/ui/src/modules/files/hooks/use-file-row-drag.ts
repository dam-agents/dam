import type { DragEvent as ReactDragEvent } from "react";
import { useMemo } from "react";

interface RowDragCallbacks {
  onEnter: (targetDir: string) => void;
  onLeave: (targetDir: string) => void;
  onDrop: (targetDir: string, files: FileList) => void;
}

function hasFiles(e: ReactDragEvent): boolean {
  return !!e.dataTransfer?.types?.includes("Files");
}

export function useFileRowDrag(targetDir: string, callbacks: RowDragCallbacks) {
  const { onEnter, onLeave, onDrop } = callbacks;
  return useMemo(() => ({
    onDragEnter: (e: ReactDragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onEnter(targetDir);
    },
    onDragOver: (e: ReactDragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: ReactDragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      onLeave(targetDir);
    },
    onDrop: (e: ReactDragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      onDrop(targetDir, e.dataTransfer.files);
    },
  }), [targetDir, onEnter, onLeave, onDrop]);
}
