import { ListTree } from "@carbon/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SidebarGroupBy } from "../../store/sidebar.js";

const GROUP_BY_LABELS: Record<SidebarGroupBy, string> = {
  all: "All sessions",
  agents: "Group by agents",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sidebar's grouping switch, drawn in the tree's Agents label and in the rail's separator, so both layouts choose between one row per Session and one row per Agent from the same menu.
 */
export function GroupByMenu({
  value,
  onChange,
  className,
}: {
  value: SidebarGroupBy;
  onChange: (value: SidebarGroupBy) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <Tooltip content="Group by" side="bottom">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Group by: ${GROUP_BY_LABELS[value]}`}
            data-testid="sidebar-group-by"
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              FOCUS_RING,
              className,
            )}
          >
            <ListTree size={14} />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next === "all" || next === "agents") onChange(next);
          }}
        >
          {(["all", "agents"] as const).map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {GROUP_BY_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
