import { cn } from "@/lib/utils";

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
