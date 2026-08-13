import { cn } from "@/lib/utils";

export const FLOATING_PANEL =
  "z-popover rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

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
