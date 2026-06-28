import { Add } from "@carbon/icons-react";
import { FilePlus, FolderPlus, FolderUp, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Add"
            disabled={isUploading}
          >
            <Add size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onNew("file")}>
            <FilePlus size={14} /> New file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNew("dir")}>
            <FolderPlus size={14} /> New folder
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isUploading} onClick={onUploadFiles}>
            <Upload size={14} /> Upload files
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isUploading} onClick={onUploadFolder}>
            <FolderUp size={14} /> Upload folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
