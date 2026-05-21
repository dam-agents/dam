import { FilePlus, FolderPlus, FolderUp, Upload } from "lucide-react";

import { DirContents } from "./dir-contents.js";
import { FileRowMenu } from "./file-row-menu.js";
import { FileViewer } from "./file-viewer.js";
import {
  FilesPanelContext,
  useFilesPanelController,
} from "./files-panel-controller.js";
import { InlineNameRow } from "./inline-name-row.js";

export function FilesPanel({
  onOpenFile,
}: {
  onOpenFile: (path: string) => void;
}) {
  const c = useFilesPanelController({ onOpenFile });

  if (c.openFile) {
    return (
      <FileViewer
        file={c.openFile}
        onClose={c.closeFile}
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <div
      className="relative flex-1 overflow-y-auto py-1"
      onDragEnter={c.handlePanelDragEnter}
      onDragOver={c.handlePanelDragOver}
      onDragLeave={c.handlePanelDragLeave}
      onDrop={c.handlePanelDrop}
    >
      <input
        ref={c.fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={c.handleFileInputChange}
      />
      <input
        ref={c.folderInputRef}
        type="file"
        multiple
        // @ts-expect-error -- non-standard but supported by Chromium-based + Safari + Firefox
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={c.handleFolderInputChange}
      />
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light">
        <span className="text-[11px] font-mono text-text-muted flex-1 truncate">
          /home/agent
        </span>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="Upload files"
          onClick={() => c.openFilePickerFor("")}
        >
          <Upload size={13} />
        </button>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="Upload folder"
          onClick={c.openFolderPicker}
        >
          <FolderUp size={13} />
        </button>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="New file"
          onClick={() => c.startNewIn("file", "")}
        >
          <FilePlus size={13} />
        </button>
        <button
          className="text-text-muted hover:text-accent p-0.5 rounded transition-colors"
          title="New folder"
          onClick={() => c.startNewIn("dir", "")}
        >
          <FolderPlus size={13} />
        </button>
      </div>
      {c.ctxValue && (
        <FilesPanelContext.Provider value={c.ctxValue}>
          {c.pendingNew && c.pendingNew.dir === "" && (
            <InlineNameRow
              kind={c.pendingNew.kind}
              depth={0}
              placeholder={
                c.pendingNew.kind === "dir" ? "new-folder" : "new-file.md"
              }
              onCommit={c.handleCommitNew}
              onCancel={c.handleCancelNew}
            />
          )}
          {c.rootIsLoadedEmpty && (
            <p className="px-4 py-5 text-[12px] text-text-muted">
              No files yet
            </p>
          )}
          <DirContents path="" depth={0} />
        </FilesPanelContext.Provider>
      )}
      {c.menu && (
        <FileRowMenu
          isDir={c.menu.type === "dir"}
          x={c.menu.x}
          y={c.menu.y}
          onClose={c.closeMenu}
          onAction={c.handleMenuAction}
        />
      )}
      {c.showPanelOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-light/80 border-2 border-dashed border-accent rounded">
          <div className="text-[12px] font-semibold text-accent">
            Drop files to upload to /home/agent
          </div>
        </div>
      )}
    </div>
  );
}
