import { ChevronLeft } from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Tooltip } from "@/components/ui/tooltip";

import { getBrand } from "../../../../brand.js";

interface Props {
  onCollapse: () => void;
  onHome: () => void;
}

export function SidebarHeader({ onCollapse, onHome }: Props) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <Tooltip content="Collapse navigation" side="bottom">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse navigation"
          className={`flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
        >
          <ChevronLeft size={16} />
        </button>
      </Tooltip>
      <button
        type="button"
        onClick={onHome}
        aria-label={getBrand().name}
        className={`min-w-0 rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
      >
        <BrandLogo />
      </button>
    </div>
  );
}
