import { ChevronDown, ChevronRight, FileText, Folder, Image as ImageIcon, MoreHorizontal } from "lucide-react";

import type { TreeEntry } from "../../../types.js";
import { useFileRowDrag } from "../hooks/use-file-row-drag.js";

interface Props {
  entry: TreeEntry;
  depth: number;
  isDot: boolean;
  isCollapsed: boolean;
  dropActive: boolean;
  menuActive: boolean;
  onOpenFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  onRequestMenu: (path: string, x: number, y: number) => void;
  onRowDragEnter: (targetDir: string) => void;
  onRowDragLeave: (targetDir: string) => void;
  onRowDrop: (targetDir: string, files: FileList) => void;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i;

function parentDirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function FileRow({
  entry,
  depth,
  isDot,
  isCollapsed,
  dropActive,
  menuActive,
  onOpenFile,
  onToggleDir,
  onRequestMenu,
  onRowDragEnter,
  onRowDragLeave,
  onRowDrop,
}: Props) {
  const { path, type } = entry;
  const isDir = type === "dir";
  const filename = path.split("/").pop() ?? "";
  const targetDir = isDir ? path : parentDirOf(path);

  const drag = useFileRowDrag(targetDir, {
    onEnter: onRowDragEnter,
    onLeave: onRowDragLeave,
    onDrop: onRowDrop,
  });

  // Dir rows highlight on drop-hover; file rows route their drops to the
  // parent dir but don't highlight (matches VSCode/Finder).
  const highlight = isDir && dropActive;

  return (
    <div
      className={`group relative flex items-center py-[5px] text-[12px] cursor-pointer transition-colors ${menuActive ? "z-20" : ""} ${highlight ? "bg-accent-light ring-1 ring-accent ring-inset" : isDir ? "text-text-secondary font-medium hover:bg-surface-raised" : "text-text-secondary hover:bg-accent-light hover:text-accent"}`}
      style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12 }}
      onClick={isDir ? () => onToggleDir(path) : () => onOpenFile(path)}
      onContextMenu={(e) => { e.preventDefault(); onRequestMenu(path, e.clientX, e.clientY); }}
      {...drag}
    >
      <div
        className="flex items-center gap-1.5 flex-1 min-w-0"
        style={{ opacity: isDot ? 0.6 : 1 }}
      >
        <RowIcons isDir={isDir} isCollapsed={isCollapsed} path={path} />
        <span className="truncate flex-1">{filename}</span>
        <button
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-text-secondary p-0.5 rounded transition-opacity"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRequestMenu(path, e.clientX, e.clientY); }}
          title="More actions"
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
    </div>
  );
}

function RowIcons({ isDir, isCollapsed, path }: { isDir: boolean; isCollapsed: boolean; path: string }) {
  const looksLikeImage = !isDir && IMAGE_EXT.test(path);
  return (
    <>
      {isDir
        ? (isCollapsed
          ? <ChevronRight size={13} className="shrink-0 text-text-muted" />
          : <ChevronDown size={13} className="shrink-0 text-text-muted" />)
        : <span className="w-[13px] shrink-0" />}
      {isDir
        ? <Folder size={13} className="shrink-0" />
        : looksLikeImage
          ? <ImageIcon size={13} className="shrink-0" />
          : <FileText size={13} className="shrink-0" />}
    </>
  );
}
