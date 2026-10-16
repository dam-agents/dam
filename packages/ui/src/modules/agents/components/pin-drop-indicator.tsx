import { cn } from "@/lib/utils";

import { usePinDropZone } from "../hooks/use-pin-drag.js";
import type { PinDrop } from "../lib/sidebar-pins.js";

export function PinDropIndicator({ at }: { at: "before" | "after" | null }) {
  if (at === null) return null;
  return (
    <span
      aria-hidden
      data-testid="sidebar-pin-drop-indicator"
      className={cn(
        "pointer-events-none absolute inset-x-1 z-raised h-0.5 rounded-full bg-accent",
        at === "before" ? "-top-px" : "-bottom-px",
      )}
    />
  );
}

export function PinDropZone({
  scope,
  onMove,
  className,
}: {
  scope: string;
  onMove: (id: string, drop: PinDrop) => void;
  className?: string;
}) {
  const zone = usePinDropZone({ scope, onMove });
  if (!zone.shown) return null;
  return (
    <div
      {...zone.dropProps}
      data-testid="sidebar-pin-drop-zone"
      className={cn(
        "flex h-[30px] items-center justify-center rounded-lg border border-dashed text-xs transition-colors",
        zone.over
          ? "border-accent bg-accent/10 text-foreground"
          : "border-border text-muted-foreground",
        className,
      )}
    >
      Drop to pin
    </div>
  );
}
