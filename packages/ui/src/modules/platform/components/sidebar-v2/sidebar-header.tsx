import { Pin, PinFilled } from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Tooltip } from "@/components/ui/tooltip";

import { getBrand } from "../../../../brand.js";

interface Props {
  pinned: boolean;
  onTogglePin: () => void;
  onHome: () => void;
}

export function SidebarHeader({ pinned, onTogglePin, onHome }: Props) {
  const pinLabel = pinned ? "Unpin navigation" : "Pin navigation";
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      <button
        type="button"
        onClick={onHome}
        aria-label={getBrand().name}
        className={`rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
      >
        <BrandLogo />
      </button>
      <Tooltip content={pinLabel} side="bottom">
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinLabel}
          aria-pressed={pinned}
          className={`flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
        >
          {pinned ? <PinFilled size={14} /> : <Pin size={14} />}
        </button>
      </Tooltip>
    </div>
  );
}
