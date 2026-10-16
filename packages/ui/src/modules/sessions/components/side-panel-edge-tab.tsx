import { ChevronLeft, ChevronRight } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function SidePanelEdgeTab({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const label = maximized ? "Restore panel size" : "Maximize panel";
  return (
    <Tooltip content={label} side={maximized ? "right" : "left"}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={maximized}
        data-testid="side-panel-maximize"
        onClick={onToggle}
        className={cn(
          "absolute top-1/2 z-raised hidden h-12 w-5 -translate-y-1/2 items-center justify-center border-y border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:flex",
          maximized
            ? "left-0 rounded-r-lg border-r"
            : "right-full rounded-l-lg border-l",
        )}
      >
        {maximized ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </Tooltip>
  );
}
