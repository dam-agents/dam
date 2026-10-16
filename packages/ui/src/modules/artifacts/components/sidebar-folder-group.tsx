import { Folder, FolderOpen } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { HOVER_ACTION } from "@/components/ui/hover-action";
import { TREE_GUIDE } from "@/components/ui/tree-guide";
import { cn } from "@/lib/utils";

import {
  type FolderDropCallbacks,
  useFolderDropTarget,
} from "../hooks/use-artifact-row-drag.js";

const INERT_DROP: FolderDropCallbacks = {
  onStart: () => {},
  onEnd: () => {},
  onEnter: () => {},
  onLeave: () => {},
  onDrop: () => {},
};

export function SidebarFolderGroup({
  folderId,
  label,
  count,
  collapsed,
  onToggle,
  drop,
  dropActive = false,
  testId,
  actions,
  children,
}: {
  folderId: string | null;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  drop?: FolderDropCallbacks;
  dropActive?: boolean;
  testId?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const dropTarget = useFolderDropTarget(folderId, drop ?? INERT_DROP);
  const FolderIcon = collapsed ? Folder : FolderOpen;
  return (
    <div
      {...(drop ? dropTarget : {})}
      className={cn(dropActive && "ring-2 ring-inset ring-primary")}
    >
      <div className="group flex h-8 items-center transition-colors hover:bg-muted">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          data-testid={testId}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-1.5 px-3 text-left text-sm",
            "text-foreground",
          )}
        >
          <FolderIcon size={16} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {count} artifact{count === 1 ? "" : "s"}
          </span>
        </button>
        {actions && <div className={cn("pr-2", HOVER_ACTION)}>{actions}</div>}
      </div>
      {!collapsed && (
        <div className={cn(TREE_GUIDE, "[--tree-guide-x:20px]")}>
          {children}
        </div>
      )}
    </div>
  );
}
