import { ChevronLeft } from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { RAIL_GLYPH, railTile } from "@/components/ui/rail-tile";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../../brand.js";

interface Props {
  onCollapse: () => void;
  onHome: () => void;
}

export function SidebarHeader({ onCollapse, onHome }: Props) {
  return (
    // UNIT_BOUNDARY_DESCRIPTION: the header's bottom border takes a pixel of its height, so the chevron tile starts at the top rather than centring in what the border leaves, and lands where the rail's first tile does.
    <div className="flex h-12 shrink-0 items-start border-b border-border px-1">
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Collapse navigation"
        className={cn(railTile(false), FOCUS_RING)}
      >
        <ChevronLeft size={RAIL_GLYPH} />
      </button>
      <button
        type="button"
        onClick={onHome}
        aria-label={getBrand().name}
        className={`-ml-1 min-w-0 self-center rounded-lg py-1 pr-1.5 pl-0 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
      >
        <BrandLogo />
      </button>
    </div>
  );
}
