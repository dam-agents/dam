import { FilePlus, FolderPlus, FolderUp, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { FileEntryKind } from "../hooks/use-file-mutations.js";

interface Props {
  isUploading: boolean;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onNew: (kind: FileEntryKind) => void;
}

export function FilesPanelToolbar({
  isUploading,
  onUploadFiles,
  onUploadFolder,
  onNew,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light">
      <span className="text-[11px] font-mono text-text-muted flex-1 truncate">
        /home/agent
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        title={isUploading ? "Upload in progress…" : "Upload files"}
        disabled={isUploading}
        onClick={onUploadFiles}
      >
        <Upload size={13} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title={isUploading ? "Upload in progress…" : "Upload folder"}
        disabled={isUploading}
        onClick={onUploadFolder}
      >
        <FolderUp size={13} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title="New file"
        onClick={() => onNew("file")}
      >
        <FilePlus size={13} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title="New folder"
        onClick={() => onNew("dir")}
      >
        <FolderPlus size={13} />
      </Button>
    </div>
  );
}
