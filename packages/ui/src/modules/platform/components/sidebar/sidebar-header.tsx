import { Pin, PinFilled } from "@carbon/icons-react";

import { BrandLogo } from "@/components/brand-logo";
import { Tooltip } from "@/components/ui/tooltip";

import { getBrand } from "../../../../brand.js";

interface Props {
  pinned: boolean;
  onTogglePin?: () => void;
  onHome: () => void;
}

export function SidebarHeader({ pinned, onTogglePin, onHome }: Props) {
  const pinLabel = pinned ? "Unpin navigation" : "Pin navigation";
  return (
    <div className="flex w-full items-center justify-between gap-2 pt-2">
      <button
        type="button"
        onClick={onHome}
        aria-label={getBrand().name}
        className="rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
      >
        <BrandLogo />
      </button>
      {onTogglePin && (
        <Tooltip content={pinLabel} side="right">
          <button
            type="button"
            onClick={onTogglePin}
            aria-label={pinLabel}
            aria-pressed={pinned}
            className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {pinned ? <PinFilled size={16} /> : <Pin size={16} />}
          </button>
        </Tooltip>
      )}
    </div>
  );
}
