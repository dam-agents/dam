import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SidebarDestination } from "../../hooks/use-sidebar-destinations.js";

export const SIDEBAR_ITEM =
  "flex h-[34px] w-full items-center gap-3 rounded-lg px-2.5 transition-colors";

export function sidebarItemTone(active: boolean): string {
  return active
    ? "text-primary bg-muted"
    : "text-foreground/80 hover:text-foreground hover:bg-muted";
}

export function SidebarNavItem({
  label,
  icon: Icon,
  active,
  navigate,
  expanded,
}: SidebarDestination & { expanded: boolean }) {
  const button = (
    <button
      type="button"
      onClick={navigate}
      aria-label={expanded ? undefined : label}
      aria-current={active ? "page" : undefined}
      className={cn(SIDEBAR_ITEM, sidebarItemTone(active))}
    >
      <Icon size={16} />
      {expanded && (
        <span className="truncate text-sm font-medium">{label}</span>
      )}
    </button>
  );
  if (expanded) return button;
  return (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  );
}
