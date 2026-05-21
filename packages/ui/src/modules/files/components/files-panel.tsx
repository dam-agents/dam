import { FilePlus, FolderPlus, FolderUp, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import { type BundleEntry, walkDataTransfer } from "../api/import-bundle.js";
import { useDirSnapshot, useFileContentQuery } from "../api/queries.js";
import {
  type FileEntryKind,
  useFileMutations,
} from "../hooks/use-file-mutations.js";
import { DirContents } from "./dir-contents.js";
import { FileRowMenu, type FileRowMenuAction } from "./file-row-menu.js";
import { FileViewer } from "./file-viewer.js";
import {
  FilesPanelContext,
  type FilesPanelContextValue,
  type MenuState,
  type PendingNew,
} from "./files-panel-context.js";
import { InlineNameRow } from "./inline-name-row.js";

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();

function hasDirectoryItem(items: DataTransferItemList): boolean {
  for (let i = 0; i < items.length; i++) {
    const ent = items[i].webkitGetAsEntry?.();
    if (ent?.isDirectory) return true;
  }
  return false;
}

export function FilesPanel({
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

  if (openFile) {
    return (
      <FileViewer
        file={openFile}
        onClose={() => setOpenFilePath(null)}
        onOpenFile={onOpenFile}
      />
    );
  }

  // Panel-level overlay only when the pointer isn't over a specific row; that
  // row has its own highlight (see FileRow).
  const showPanelOverlay = panelDragActive && dragTargetPath === null;
  const rootIsLoadedEmpty =
    rootSnapshot.data?.ok === true &&
    rootSnapshot.data.entries.length === 0 &&
    !pendingNew;

  return (
    <div
      className="relative flex-1 overflow-y-auto py-1"
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer?.types?.includes("Files")) setPanelDragActive(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setPanelDragActive(false);
        setDragTargetPath(null);
      }}
      onDrop={(e) => {
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
        if (e.dataTransfer.files?.length)
          void uploadFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const target = pickerTargetDirRef.current;
          pickerTargetDirRef.current = "";
          if (e.target.files) void uploadFiles(e.target.files, target);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error -- non-standard but supported by Chromium-based + Safari + Firefox
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          folderPickerTargetDirRef.current = "";
          const files = e.target.files;
          if (files && files.length > 0) {
            const entries: BundleEntry[] = Array.from(files).map((f) => ({
              path:
                (f as File & { webkitRelativePath?: string })
                  .webkitRelativePath || f.name,
              file: f,
            }));
            void uploadBundle(entries);
          }
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light">
        <span className="text-[11px] font-mono text-text-muted flex-1 truncate">
          /home/agent
        </span>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="Upload files"
          onClick={() => openFilePickerFor("")}
        >
          <Upload size={13} />
        </button>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="Upload folder"
          onClick={() => {
            folderPickerTargetDirRef.current = "";
            folderInputRef.current?.click();
          }}
        >
          <FolderUp size={13} />
        </button>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="New file"
          onClick={() => startNewIn("file", "")}
        >
          <FilePlus size={13} />
        </button>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="New folder"
          onClick={() => startNewIn("dir", "")}
        >
          <FolderPlus size={13} />
        </button>
      </div>
      {ctxValue && (
        <FilesPanelContext.Provider value={ctxValue}>
          {pendingNew && pendingNew.dir === "" && (
            <InlineNameRow
              kind={pendingNew.kind}
              depth={0}
              placeholder={
                pendingNew.kind === "dir" ? "new-folder" : "new-file.md"
              }
              onCommit={handleCommitNew}
              onCancel={handleCancelNew}
            />
          )}
          {rootIsLoadedEmpty && (
            <p className="px-4 py-5 text-[12px] text-text-muted">
              No files yet
            </p>
          )}
          <DirContents path="" depth={0} />
        </FilesPanelContext.Provider>
      )}
      {menu && (
        <FileRowMenu
          isDir={menu.type === "dir"}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onAction={handleMenuAction}
        />
      )}
      {showPanelOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-light/80 border-2 border-dashed border-accent rounded">
          <div className="text-[12px] font-semibold text-accent">
            Drop files to upload to /home/agent
          </div>
        </div>
      )}
    </div>
  );
}
