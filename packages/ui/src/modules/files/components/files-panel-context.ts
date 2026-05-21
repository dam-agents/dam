import { createContext, useContext } from "react";

import type { FileEntryKind } from "../hooks/use-file-mutations.js";

export interface PendingNew {
  kind: FileEntryKind;
  dir: string;
}

export interface MenuState {
  path: string;
  type: "file" | "dir";
  x: number;
  y: number;
}

/** Internal panel state + handlers shared with every `<DirContents>` and
 *  `<FileRow>` instance. Living in a panel-scoped context avoids drilling
 *  ten handlers through every recursive layer. */
export interface FilesPanelContextValue {
  agentId: string;
  expandedDirs: ReadonlySet<string>;
  pendingNew: PendingNew | null;
  renamingPath: string | null;
  dragTargetPath: string | null;
  menu: MenuState | null;
  onOpenFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  onCommitRename: (from: string, nextName: string) => void;
  onCancelRename: () => void;
  onCommitNew: (rawName: string) => void;
  onCancelNew: () => void;
  onRequestMenu: (
    path: string,
    type: "file" | "dir",
    x: number,
    y: number,
  ) => void;
  onRowDragEnter: (targetDir: string) => void;
  onRowDragLeave: (targetDir: string) => void;
  onRowDrop: (targetDir: string, files: FileList) => void;
}

export const FilesPanelContext = createContext<FilesPanelContextValue | null>(
  null,
);

export function useFilesPanel(): FilesPanelContextValue {
  const ctx = useContext(FilesPanelContext);
  if (!ctx) throw new Error("useFilesPanel must be used inside FilesPanel");
  return ctx;
}
