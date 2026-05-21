import type { ChangeEvent, DragEvent } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useStore } from "../../../store.js";
import { type BundleEntry, walkDataTransfer } from "../api/import-bundle.js";
import { useDirSnapshot, useFileContentQuery } from "../api/queries.js";
import {
  type FileEntryKind,
  useFileMutations,
} from "../hooks/use-file-mutations.js";
import type { FileRowMenuAction } from "./file-row-menu.js";

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

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();

function hasDirectoryItem(items: DataTransferItemList): boolean {
  for (let i = 0; i < items.length; i++) {
    const ent = items[i].webkitGetAsEntry?.();
    if (ent?.isDirectory) return true;
  }
  return false;
}

export function useFilesPanelController({
  onOpenFile,
}: {
  onOpenFile: (path: string) => void;
}) {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const openFilePath = useStore((s) => s.openFilePath);
  const setOpenFilePath = useStore((s) => s.setOpenFilePath);
  const toggleExpandedDir = useStore((s) => s.toggleExpandedDir);
  const expandedDirs = useStore((s) =>
    selectedAgent
      ? (s.expandedDirs[selectedAgent] ?? EMPTY_EXPANDED)
      : EMPTY_EXPANDED,
  );

  const rootSnapshot = useDirSnapshot(selectedAgent, "");

  const { createEntry, renameEntry, deleteEntry, uploadFiles, uploadBundle } =
    useFileMutations(selectedAgent);
  const { data: openFile, error: openFileError } = useFileContentQuery(
    selectedAgent,
    openFilePath,
  );

  // If the file disappeared (rename, delete, git switch), close the viewer
  // silently rather than surface the error.
  useEffect(() => {
    if (openFileError) setOpenFilePath(null);
  }, [openFileError, setOpenFilePath]);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState<PendingNew | null>(null);
  const [panelDragActive, setPanelDragActive] = useState(false);
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  // Stashes the dir the next picker invocation should upload into. Cleared
  // after onChange fires so subsequent toolbar picks default to root.
  const pickerTargetDirRef = useRef<string>("");
  const folderPickerTargetDirRef = useRef<string>("");

  const handleToggleDir = useCallback(
    (path: string) => {
      if (!selectedAgent) return;
      toggleExpandedDir(selectedAgent, path);
    },
    [selectedAgent, toggleExpandedDir],
  );

  const ensureExpanded = useCallback(
    (dir: string) => {
      if (!dir || !selectedAgent) return;
      if (expandedDirs.has(dir)) return;
      toggleExpandedDir(selectedAgent, dir);
    },
    [expandedDirs, selectedAgent, toggleExpandedDir],
  );

  const startNewIn = useCallback(
    (kind: FileEntryKind, dir: string) => {
      ensureExpanded(dir);
      setPendingNew({ kind, dir });
      setRenamingPath(null);
    },
    [ensureExpanded],
  );

  const openFilePickerFor = useCallback((dir: string) => {
    pickerTargetDirRef.current = dir;
    fileInputRef.current?.click();
  }, []);

  const openFolderPicker = useCallback(() => {
    folderPickerTargetDirRef.current = "";
    folderInputRef.current?.click();
  }, []);

  const handleRowDragEnter = useCallback((targetDir: string) => {
    setDragTargetPath(targetDir);
  }, []);

  const handleRowDragLeave = useCallback((targetDir: string) => {
    // A new row's dragenter fires before the previous row's dragleave, so
    // only clear if we haven't already moved into another row.
    setDragTargetPath((prev) => (prev === targetDir ? null : prev));
  }, []);

  const handleRowDrop = useCallback(
    (targetDir: string, files: FileList) => {
      setDragTargetPath(null);
      setPanelDragActive(false);
      void uploadFiles(files, targetDir);
    },
    [uploadFiles],
  );

  const handleRequestMenu = useCallback(
    (path: string, type: "file" | "dir", x: number, y: number) => {
      setMenu((prev) => (prev?.path === path ? null : { path, type, x, y }));
    },
    [],
  );

  const handleMenuAction = useCallback(
    (action: FileRowMenuAction) => {
      if (!menu) return;
      const { path, type } = menu;
      const isDir = type === "dir";
      switch (action) {
        case "new-file":
          if (isDir) startNewIn("file", path);
          return;
        case "new-folder":
          if (isDir) startNewIn("dir", path);
          return;
        case "upload-here":
          if (isDir) openFilePickerFor(path);
          return;
        case "rename":
          setRenamingPath(path);
          setPendingNew(null);
          return;
        case "delete":
          void deleteEntry(path, type);
          return;
      }
    },
    [menu, startNewIn, openFilePickerFor, deleteEntry],
  );

  const handleCommitRename = useCallback(
    (from: string, nextName: string) => {
      setRenamingPath(null);
      void renameEntry({ from, nextName });
    },
    [renameEntry],
  );

  const handleCommitNew = useCallback(
    (rawName: string) => {
      if (!pendingNew) return;
      const { kind, dir } = pendingNew;
      setPendingNew(null);
      void createEntry({ kind, dir, name: rawName });
    },
    [pendingNew, createEntry],
  );

  const handleCancelRename = useCallback(() => setRenamingPath(null), []);
  const handleCancelNew = useCallback(() => setPendingNew(null), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeFile = useCallback(() => setOpenFilePath(null), [setOpenFilePath]);

  const handleFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const target = pickerTargetDirRef.current;
      pickerTargetDirRef.current = "";
      if (e.target.files) void uploadFiles(e.target.files, target);
      e.target.value = "";
    },
    [uploadFiles],
  );

  const handleFolderInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      folderPickerTargetDirRef.current = "";
      const files = e.target.files;
      if (files && files.length > 0) {
        const entries: BundleEntry[] = Array.from(files).map((f) => ({
          path:
            (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
            f.name,
          file: f,
        }));
        void uploadBundle(entries);
      }
      e.target.value = "";
    },
    [uploadBundle],
  );

  const handlePanelDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer?.types?.includes("Files")) setPanelDragActive(true);
  }, []);

  const handlePanelDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handlePanelDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setPanelDragActive(false);
    setDragTargetPath(null);
  }, []);

  const handlePanelDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      setPanelDragActive(false);
      setDragTargetPath(null);
      // Row handlers stopPropagation before this fires, so reaching here
      // means the drop happened on empty panel space → upload to root.
      const items = e.dataTransfer.items;
      if (items && hasDirectoryItem(items)) {
        void (async () => {
          const entries = await walkDataTransfer(items);
          void uploadBundle(entries);
        })();
        return;
      }
      if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
    },
    [uploadBundle, uploadFiles],
  );

  const ctxValue = useMemo<FilesPanelContextValue | null>(
    () =>
      selectedAgent
        ? {
            agentId: selectedAgent,
            expandedDirs,
            pendingNew,
            renamingPath,
            dragTargetPath,
            menu,
            onOpenFile,
            onToggleDir: handleToggleDir,
            onCommitRename: handleCommitRename,
            onCancelRename: handleCancelRename,
            onCommitNew: handleCommitNew,
            onCancelNew: handleCancelNew,
            onRequestMenu: handleRequestMenu,
            onRowDragEnter: handleRowDragEnter,
            onRowDragLeave: handleRowDragLeave,
            onRowDrop: handleRowDrop,
          }
        : null,
    [
      selectedAgent,
      expandedDirs,
      pendingNew,
      renamingPath,
      dragTargetPath,
      menu,
      onOpenFile,
      handleToggleDir,
      handleCommitRename,
      handleCancelRename,
      handleCommitNew,
      handleCancelNew,
      handleRequestMenu,
      handleRowDragEnter,
      handleRowDragLeave,
      handleRowDrop,
    ],
  );

  const rootIsLoadedEmpty =
    rootSnapshot.data?.ok === true &&
    rootSnapshot.data.entries.length === 0 &&
    !pendingNew;

  // Panel-level overlay only when the pointer isn't over a specific row; that
  // row has its own highlight (see FileRow).
  const showPanelOverlay = panelDragActive && dragTargetPath === null;

  return {
    ctxValue,
    openFile,
    pendingNew,
    menu,
    rootIsLoadedEmpty,
    showPanelOverlay,
    fileInputRef,
    folderInputRef,
    closeFile,
    closeMenu,
    startNewIn,
    openFilePickerFor,
    openFolderPicker,
    handleMenuAction,
    handleCommitNew,
    handleCancelNew,
    handleFileInputChange,
    handleFolderInputChange,
    handlePanelDragEnter,
    handlePanelDragOver,
    handlePanelDragLeave,
    handlePanelDrop,
  };
}
