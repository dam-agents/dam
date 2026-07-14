import { FilePlus, FolderPlus, FolderUp, Plus, Upload } from "lucide-react";
import type { CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { DirContents } from "./dir-contents.js";
import { FileViewer } from "./file-viewer.js";
import {
  FilesPanelContext,
  useFilesPanelController,
} from "./files-panel-controller.js";
import { InlineNameRow } from "./inline-name-row.js";

export function FilesPanel({
  open,
  onToggle,
  className,
  style,
  onOpenFile,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
  onOpenFile: (path: string, opts?: { edit?: boolean }) => void;
}) {
  const controller = useFilesPanelController({ onOpenFile });

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          className="text-[14px]"
          disabled={controller.isUploading}
          title={controller.isUploading ? "Upload in progress…" : "Add"}
        >
          <Plus size={12} /> Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => controller.openFilePickerFor("")}>
          <Upload size={13} /> Upload file
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={controller.openFolderPicker}>
          <FolderUp size={13} /> Upload folder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => controller.startNewIn("file", "")}>
          <FilePlus size={13} /> New file
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => controller.startNewIn("dir", "")}>
          <FolderPlus size={13} /> New folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <SidebarSection
      title="Files"
      open={open}
      onToggle={onToggle}
      headerRight={addMenu}
      className={className}
      headerClassName="border-t border-border-light"
      style={style}
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
      {controller.openFile ? (
        <FileViewer
          key={controller.openFile.path}
          file={controller.openFile}
          onClose={controller.closeFile}
          onOpenFile={onOpenFile}
        />
      ) : (
        <div
          className="relative flex-1 overflow-y-auto py-1"
          onDragEnter={controller.handlePanelDragEnter}
          onDragOver={controller.handlePanelDragOver}
          onDragLeave={controller.handlePanelDragLeave}
          onDrop={controller.handlePanelDrop}
        >
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
          {controller.showPanelOverlay && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-light/80 border-2 border-dashed border-accent rounded">
              <div className="text-[12px] font-semibold text-accent">
                Drop files to upload to /home/agent
              </div>
            </div>
          )}
        </div>
      )}
    </SidebarSection>
  );
}
