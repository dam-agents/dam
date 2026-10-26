import { Folder } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { DisclosureChevron } from "@/components/ui/disclosure";
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
  children: ReactNode;
}) {
  const dropTarget = useFolderDropTarget(folderId, drop ?? INERT_DROP);
  return (
    <div
      {...(drop ? dropTarget : {})}
      className={cn(dropActive && "ring-2 ring-inset ring-primary")}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        data-testid={testId}
        className={cn(
          "flex h-8 w-full items-center gap-1.5 px-3 text-left text-sm",
          "text-foreground transition-colors hover:bg-muted",
        )}
      >
        <DisclosureChevron
          open={!collapsed}
          size={14}
          className="text-muted-foreground"
        />
        <Folder size={14} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {count} artifact{count === 1 ? "" : "s"}
        </span>
      </button>
      {!collapsed && children}
    </div>
  );
}
