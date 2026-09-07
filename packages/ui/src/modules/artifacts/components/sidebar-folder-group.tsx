import { Folder } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { DisclosureChevron } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";

export function SidebarFolderGroup({
  label,
  count,
  collapsed,
  onToggle,
  testId,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div>
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
