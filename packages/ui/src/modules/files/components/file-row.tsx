import {
  Document,
  Folder,
  Image,
  OverflowMenuHorizontal,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DisclosureChevron } from "@/components/ui/disclosure";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";

import { useStore } from "../../../store.js";
import { useFileRowDrag } from "../hooks/use-file-row-drag.js";
import {
  type FileRowMenuAction,
  FileRowMenuItems,
} from "./file-row-menu-items.js";
import { useFilesPanel } from "./files-panel-controller.js";

interface Props {
  name: string;
  path: string;
  type: "file" | "dir";
  depth: number;
  isDot: boolean;
  isCollapsed: boolean;
  dropActive: boolean;
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
}: Props) {
  const panel = useFilesPanel();
  const isDir = type === "dir";
  const isActive = useStore((s) => s.openFilePath) === path && !isDir;
  const targetDir = isDir ? path : parentDirOf(path);
  // Raise the row above its siblings while its menu is open (parity with the
  // previous coordinate menu); Radix portals the menu content itself.
  const [menuOpen, setMenuOpen] = useState(false);

  const drag = useFileRowDrag(
    targetDir,
    { path, type },
    {
      onEnter: panel.onRowDragEnter,
      onLeave: panel.onRowDragLeave,
      onEnd: panel.onRowDragEnd,
      onDrop: panel.onRowDrop,
      onMove: panel.onRowMove,
    },
  );

  const dispatch = (action: FileRowMenuAction) =>
    panel.onAction(action, path, type);

  // Dir rows highlight on drop-hover; file rows route their drops to the
  // parent dir but don't highlight (matches VSCode/Finder).
  const highlight = isDir && dropActive;

  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          className={`group relative flex items-center h-8 text-sm cursor-pointer transition-colors ${menuOpen ? "z-raised" : ""} ${highlight ? "bg-muted ring-1 ring-primary ring-inset text-muted-foreground font-medium" : `text-muted-foreground hover:bg-muted ${isDir ? "font-medium" : ""} ${isActive ? "bg-muted" : ""}`}`}
          style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12 }}
          onClick={
            isDir ? () => panel.onToggleDir(path) : () => panel.onOpenFile(path)
          }
          {...drag}
        >
          <div
            className="flex items-center gap-1.5 flex-1 min-w-0"
            style={{ opacity: isDot ? 0.6 : 1 }}
          >
            <RowIcons isDir={isDir} isCollapsed={isCollapsed} name={name} />
            <span className="truncate flex-1">{name}</span>
            <DropdownMenu onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={HOVER_ACTION}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="More actions"
                  tooltip="More actions"
                >
                  <OverflowMenuHorizontal size={13} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <FileRowMenuItems
                  isDir={isDir}
                  onAction={dispatch}
                  Item={DropdownMenuItem}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <FileRowMenuItems
          isDir={isDir}
          onAction={dispatch}
          Item={ContextMenuItem}
        />
      </ContextMenuContent>
    </ContextMenu>
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
        <span className="w-4 shrink-0 flex items-center justify-center">
          <DisclosureChevron
            open={!isCollapsed}
            className="text-muted-foreground"
          />
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      {isDir ? (
        <Folder size={16} className="shrink-0" />
      ) : looksLikeImage ? (
        <Image size={16} className="shrink-0" />
      ) : (
        <Document size={16} className="shrink-0" />
      )}
    </>
  );
}
