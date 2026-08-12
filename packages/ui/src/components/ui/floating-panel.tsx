import { cn } from "@/lib/utils";

/** Surface shared by the anchored panels — popover and hover card — so radius,
 *  border, elevation, and entry animation can't drift between them. */
export const FLOATING_PANEL =
  "z-popover rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

/** A rotated square rather than the primitive's triangle: pulled half over the
 *  panel's edge, it carries the border on its two outward sides and its filled
 *  half hides the segment of the panel border behind it — which a filled
 *  triangle sitting outside the edge cannot do. Radix rotates the `Arrow`
 *  wrapper per side, so the same markup reads correctly on all four.
 *
 *  Render inside the primitive's `Arrow` with `asChild`. */
export function FloatingPanelTail({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-[9px] w-[9px] -translate-y-1/2 rotate-45 border-b border-r border-border bg-popover",
        className,
      )}
    />
  );
}
