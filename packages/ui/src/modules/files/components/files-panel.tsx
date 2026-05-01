import { FilePlus, FolderPlus, Upload } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import type { TreeEntry } from "../../../types.js";
import { useFileContentQuery } from "../api/queries.js";
import { type FileEntryKind, useFileMutations } from "../hooks/use-file-mutations.js";
import { FileRow } from "./file-row.js";
import { FileRowMenu,type FileRowMenuAction } from "./file-row-menu.js";
import { FileViewer } from "./file-viewer.js";
import { InlineNameRow } from "./inline-name-row.js";

interface PendingNew {
  kind: FileEntryKind;
  dir: string;
}

interface MenuState {
  path: string;
  x: number;
  y: number;
}

function isDotName(path: string): boolean {
  return path.split("/").pop()!.startsWith(".");
}

function depthOf(path: string): number {
  return path.split("/").length - 1;
}

function compareTreeEntries(a: TreeEntry, b: TreeEntry): number {
  const ap = a.path.split("/");
  const bp = b.path.split("/");
  const min = Math.min(ap.length, bp.length);
  for (let i = 0; i < min; i++) {
    if (ap[i] !== bp[i]) {
      const aIsDir = i < ap.length - 1 || a.type === "dir";
      const bIsDir = i < bp.length - 1 || b.type === "dir";
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return ap[i].localeCompare(bp[i]);
    }
  }
  return ap.length - bp.length;
}

export function FilesPanel({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const selectedInstance = useStore(s => s.selectedInstance);
  const openFilePath = useStore(s => s.openFilePath);
  const setOpenFilePath = useStore(s => s.setOpenFilePath);

  const { fileTree, createEntry, renameEntry, deleteEntry, uploadFiles } = useFileMutations(selectedInstance);
  const { data: openFile, error: openFileError } = useFileContentQuery(selectedInstance, openFilePath);

  // If the file disappeared (rename, delete, git switch), close the viewer
  // silently rather than surface the error.
  useEffect(() => {
    if (openFileError) setOpenFilePath(null);
  }, [openFileError, setOpenFilePath]);

  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState<PendingNew | null>(null);
  const [panelDragActive, setPanelDragActive] = useState(false);
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Stashes the dir the next picker invocation should upload into. Cleared
  // after onChange fires so subsequent toolbar picks default to root.
  const pickerTargetDirRef = useRef<string>("");

  const sortedTree = useMemo(() => [...fileTree].sort(compareTreeEntries), [fileTree]);

  const isDirCollapsed = useCallback((path: string) => {
    const userToggled = toggled.has(path);
    const defaultCollapsed = isDotName(path);
    return userToggled ? !defaultCollapsed : defaultCollapsed;
  }, [toggled]);

  const toggleDir = useCallback((path: string) => {
    setToggled(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const isVisible = useCallback((path: string) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (isDirCollapsed(parts.slice(0, i).join("/"))) return false;
    }
    return true;
  }, [isDirCollapsed]);

  const ensureExpanded = useCallback((dir: string) => {
    if (!dir || !isDirCollapsed(dir)) return;
    toggleDir(dir);
  }, [isDirCollapsed, toggleDir]);

  const startNewIn = useCallback((kind: FileEntryKind, dir: string) => {
    ensureExpanded(dir);
    setPendingNew({ kind, dir });
    setRenamingPath(null);
  }, [ensureExpanded]);

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
    setDragTargetPath(prev => (prev === targetDir ? null : prev));
  }, []);

  const handleRowDrop = useCallback((targetDir: string, files: FileList) => {
    setDragTargetPath(null);
    setPanelDragActive(false);
    void uploadFiles(files, targetDir);
  }, [uploadFiles]);

  const handleRequestMenu = useCallback((path: string, x: number, y: number) => {
    setMenu(prev => (prev?.path === path ? null : { path, x, y }));
  }, []);

  const handleMenuAction = useCallback((action: FileRowMenuAction) => {
    if (!menu) return;
    const { path } = menu;
    const entry = fileTree.find(e => e.path === path);
    const isDir = entry?.type === "dir";
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
        void deleteEntry(path);
        return;
    }
  }, [menu, fileTree, startNewIn, openFilePickerFor, deleteEntry]);

  const handleCommitRename = useCallback((from: string, nextName: string) => {
    setRenamingPath(null);
    void renameEntry({ from, nextName });
  }, [renameEntry]);

  const handleCommitNew = useCallback((rawName: string) => {
    if (!pendingNew) return;
    const { kind, dir } = pendingNew;
    setPendingNew(null);
    void createEntry({ kind, dir, name: rawName });
  }, [pendingNew, createEntry]);

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

  const visibleEntries = sortedTree.filter(entry => isVisible(entry.path));
  const menuEntry = menu ? fileTree.find(e => e.path === menu.path) : null;

  return (
    <div
      className="relative flex-1 overflow-y-auto py-1"
      onDragEnter={(e) => { e.preventDefault(); if (e.dataTransfer?.types?.includes("Files")) setPanelDragActive(true); }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setPanelDragActive(false);
        setDragTargetPath(null);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setPanelDragActive(false);
        setDragTargetPath(null);
        // Row handlers stopPropagation before this fires, so reaching here
        // means the drop happened on empty panel space → upload to root.
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
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light">
        <span className="text-[11px] font-mono text-text-muted flex-1 truncate">/home/agent</span>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="Upload files"
          onClick={() => openFilePickerFor("")}
        >
          <Upload size={13} />
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
      {pendingNew && pendingNew.dir === "" && (
        <InlineNameRow
          kind={pendingNew.kind}
          depth={0}
          placeholder={pendingNew.kind === "dir" ? "new-folder" : "new-file.md"}
          onCommit={handleCommitNew}
          onCancel={() => setPendingNew(null)}
        />
      )}
      {visibleEntries.length === 0 && !pendingNew && (
        <p className="px-4 py-5 text-[12px] text-text-muted">No files yet</p>
      )}
      {visibleEntries.map(entry => (
        <Fragment key={entry.path}>
          {renamingPath === entry.path ? (
            <InlineNameRow
              kind={entry.type === "dir" ? "dir" : "file"}
              depth={depthOf(entry.path)}
              initial={entry.path.split("/").pop() ?? ""}
              onCommit={(next) => handleCommitRename(entry.path, next)}
              onCancel={() => setRenamingPath(null)}
            />
          ) : (
            <FileRow
              entry={entry}
              depth={depthOf(entry.path)}
              isDot={isDotName(entry.path)}
              isCollapsed={entry.type === "dir" && isDirCollapsed(entry.path)}
              dropActive={entry.type === "dir" && dragTargetPath === entry.path}
              menuActive={menu?.path === entry.path}
              onOpenFile={onOpenFile}
              onToggleDir={toggleDir}
              onRequestMenu={handleRequestMenu}
              onRowDragEnter={handleRowDragEnter}
              onRowDragLeave={handleRowDragLeave}
              onRowDrop={handleRowDrop}
            />
          )}
          {pendingNew && pendingNew.dir === entry.path && (
            <InlineNameRow
              kind={pendingNew.kind}
              depth={depthOf(entry.path) + 1}
              placeholder={pendingNew.kind === "dir" ? "new-folder" : "new-file.md"}
              onCommit={handleCommitNew}
              onCancel={() => setPendingNew(null)}
            />
          )}
        </Fragment>
      ))}
      {menu && (
        <FileRowMenu
          isDir={menuEntry?.type === "dir"}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onAction={handleMenuAction}
        />
      )}
      {showPanelOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-light/80 border-2 border-dashed border-accent rounded">
          <div className="text-[12px] font-semibold text-accent">Drop files to upload to /home/agent</div>
        </div>
      )}
    </div>
  );
}
