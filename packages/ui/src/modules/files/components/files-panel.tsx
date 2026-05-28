import { DirContents } from "./dir-contents.js";
import { FileRowMenu } from "./file-row-menu.js";
import { FileViewer } from "./file-viewer.js";
import {
  FilesPanelContext,
  useFilesPanelController,
} from "./files-panel-controller.js";
import { FilesPanelToolbar } from "./files-panel-toolbar.js";
import { InlineNameRow } from "./inline-name-row.js";

export function FilesPanel({
  onOpenFile,
}: {
  onOpenFile: (path: string) => void;
}) {
  const controller = useFilesPanelController({ onOpenFile });

  if (controller.openFile) {
    return (
      <FileViewer
        file={controller.openFile}
        onClose={controller.closeFile}
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <div
      className="relative flex-1 overflow-y-auto py-1"
      onDragEnter={controller.handlePanelDragEnter}
      onDragOver={controller.handlePanelDragOver}
      onDragLeave={controller.handlePanelDragLeave}
      onDrop={controller.handlePanelDrop}
    >
      <input
        ref={controller.fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={controller.handleFileInputChange}
      />
      <input
        ref={controller.folderInputRef}
        type="file"
        multiple
        // @ts-expect-error -- non-standard but supported by Chromium-based + Safari + Firefox
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={controller.handleFolderInputChange}
      />
      <FilesPanelToolbar
        onUploadFiles={() => controller.openFilePickerFor("")}
        onUploadFolder={controller.openFolderPicker}
        onNew={(kind) => controller.startNewIn(kind, "")}
      />
      {controller.ctxValue && (
        <FilesPanelContext.Provider value={controller.ctxValue}>
          {controller.pendingNew && controller.pendingNew.dir === "" && (
            <InlineNameRow
              kind={controller.pendingNew.kind}
              depth={0}
              placeholder={
                controller.pendingNew.kind === "dir"
                  ? "new-folder"
                  : "new-file.md"
              }
              onCommit={controller.handleCommitNew}
              onCancel={controller.handleCancelNew}
            />
          )}
          {controller.rootIsLoadedEmpty && (
            <p className="px-4 py-5 text-[12px] text-text-muted">
              No files yet
            </p>
          )}
          <DirContents path="" depth={0} />
        </FilesPanelContext.Provider>
      )}
      {controller.menu && (
        <FileRowMenu
          isDir={controller.menu.type === "dir"}
          x={controller.menu.x}
          y={controller.menu.y}
          onClose={controller.closeMenu}
          onAction={controller.handleMenuAction}
        />
      )}
      {controller.showPanelOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-light/80 border-2 border-dashed border-accent rounded">
          <div className="text-[12px] font-semibold text-accent">
            Drop files to upload to /home/agent
          </div>
        </div>
      )}
    </div>
  );
}
