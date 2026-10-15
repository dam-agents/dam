import { ChevronLeft, ChevronRight } from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
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
          className="rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
        >
          <BrandLogo />
        </button>
      )}
      <Tooltip content={toggleLabel} side="right">
        <button
          type="button"
          onClick={onToggle}
          aria-label={toggleLabel}
          aria-expanded={expanded}
          className={cn(
            "group relative flex items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground",
            expanded
              ? "p-1.5 text-muted-foreground"
              : "h-10 w-10 text-foreground/80",
          )}
        >
          {expanded ? (
            <ChevronLeft size={16} />
          ) : (
            <>
              <BrandLogo className="opacity-0 transition-opacity hover-capable:opacity-100 group-hover:opacity-0 group-focus-visible:opacity-0" />
              <ChevronRight
                size={16}
                className="absolute transition-opacity hover-capable:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </>
          )}
        </button>
      </Tooltip>
    </div>
  );
}
