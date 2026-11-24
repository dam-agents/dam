import { ChevronLeft, ChevronRight } from "@carbon/icons-react";

import { BrandLogoSlot } from "@/components/brand-logo-slot";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../../brand.js";

interface Props {
  expanded: boolean;
  onToggle: () => void;
  onHome: () => void;
}

export function SidebarHeader({ expanded, onToggle, onHome }: Props) {
  const toggleLabel = expanded ? "Collapse navigation" : "Expand navigation";
  return (
    <div
      className={cn(
        "flex items-center pt-2",
        expanded ? "w-full justify-between gap-2" : "justify-center",
      )}
    >
      {expanded && (
        <button
          type="button"
          onClick={onHome}
          aria-label={getBrand().name}
          className="flex h-10 items-center rounded-lg px-2.5 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
        >
          <BrandLogoSlot />
        </button>
      )}
      <Tooltip content={toggleLabel} side="right">
        <button
          type="button"
          onClick={onToggle}
          aria-label={toggleLabel}
          aria-expanded={expanded}
          className={cn(
            "flex items-center rounded-lg transition-colors hover:bg-muted hover:text-foreground",
            expanded
              ? "justify-center p-1.5 text-muted-foreground"
              : "h-10 w-full justify-start pl-2.5 text-foreground/80",
          )}
        >
          {expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </Tooltip>
    </div>
  );
}
