import { ChevronLeft } from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { RAIL_GLYPH, railTile } from "@/components/ui/rail-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../../brand.js";

interface Props {
  onCollapse: () => void;
  onHome: () => void;
}

export function SidebarHeader({ onCollapse, onHome }: Props) {
  return (
    <div className="flex h-12 shrink-0 items-center border-b border-border px-1">
      <Tooltip content="Collapse navigation" side="bottom">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse navigation"
          className={cn(railTile(false), FOCUS_RING)}
        >
          <ChevronLeft size={RAIL_GLYPH} />
        </button>
      </Tooltip>
      <button
        type="button"
        onClick={onHome}
        aria-label={getBrand().name}
        className={`-ml-1 min-w-0 rounded-lg py-1 pr-1.5 pl-0 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
      >
        <BrandLogo />
      </button>
    </div>
  );
}
