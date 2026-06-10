import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Image as ImageIcon,
  MoreHorizontal,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { useFileRowDrag } from "../hooks/use-file-row-drag.js";
import { useFilesPanel } from "./files-panel-controller.js";

interface Props {
  name: string;
  path: string;
  type: "file" | "dir";
  depth: number;
  isDot: boolean;
  isCollapsed: boolean;
  dropActive: boolean;
  menuActive: boolean;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i;

function parentDirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function FileRow({
  name,
  path,
  type,
  depth,
  isDot,
  isCollapsed,
  dropActive,
  menuActive,
}: Props) {
  const panel = useFilesPanel();
  const isDir = type === "dir";
  const targetDir = isDir ? path : parentDirOf(path);

  const drag = useFileRowDrag(targetDir, {
    onEnter: panel.onRowDragEnter,
    onLeave: panel.onRowDragLeave,
    onDrop: panel.onRowDrop,
  });

  // Dir rows highlight on drop-hover; file rows route their drops to the
  // parent dir but don't highlight (matches VSCode/Finder).
  const highlight = isDir && dropActive;

  return (
    <div
      className={`group relative flex items-center py-[5px] text-[12px] cursor-pointer transition-colors ${menuActive ? "z-20" : ""} ${highlight ? "bg-accent-light ring-1 ring-accent ring-inset" : isDir ? "text-text-secondary font-medium hover:bg-surface-raised" : "text-text-secondary hover:bg-accent-light hover:text-accent"}`}
      style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12 }}
      onClick={
        isDir ? () => panel.onToggleDir(path) : () => panel.onOpenFile(path)
      }
      onContextMenu={(e) => {
        e.preventDefault();
        panel.onRequestMenu(path, type, e.clientX, e.clientY);
      }}
      {...drag}
    >
      <div
        className="flex items-center gap-1.5 flex-1 min-w-0"
        style={{ opacity: isDot ? 0.6 : 1 }}
      >
        <RowIcons isDir={isDir} isCollapsed={isCollapsed} name={name} />
        <span className="truncate flex-1">{name}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            panel.onRequestMenu(path, type, e.clientX, e.clientY);
          }}
          title="More actions"
        >
          <MoreHorizontal size={13} />
        </Button>
      </div>
    </div>
  );
}

function RowIcons({
  isDir,
  isCollapsed,
  name,
}: {
  isDir: boolean;
  isCollapsed: boolean;
  name: string;
}) {
  const looksLikeImage = !isDir && IMAGE_EXT.test(name);
  return (
    <>
      {isDir ? (
        isCollapsed ? (
          <ChevronRight size={13} className="shrink-0 text-text-muted" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-text-muted" />
        )
      ) : (
        <span className="w-[13px] shrink-0" />
      )}
      {isDir ? (
        <Folder size={13} className="shrink-0" />
      ) : looksLikeImage ? (
        <ImageIcon size={13} className="shrink-0" />
      ) : (
        <FileText size={13} className="shrink-0" />
      )}
    </>
  );
}
