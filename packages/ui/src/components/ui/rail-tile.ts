import { cn } from "@/lib/utils";

// UNIT_BOUNDARY_DESCRIPTION: every item of the left and right rails is drawn at one of these sizes, so the rails read as one column of equally sized targets; the Avatar is the size of an Agent's avatar in the expanded sidebar, and SIDEBAR_GLYPH the icons inside its rows.
export const RAIL_GLYPH = 22;
export const RAIL_AVATAR = 36;
export const SIDEBAR_GLYPH = 14;

// UNIT_BOUNDARY_DESCRIPTION: both rails lay their tiles out through these, so an item, the space between items and the padding above them are the same on either side of the page.
export const RAIL_GAP = "gap-1.5";
export const RAIL_COLUMN = `flex flex-col items-center ${RAIL_GAP} py-2`;
export const RAIL_SEPARATOR =
  "pointer-events-none absolute inset-x-0 flex justify-center";

export function railTile(active: boolean): string {
  return cn(
    "group relative flex size-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-muted text-foreground ring-1 ring-border-ui"
      : "hover:bg-muted/60 hover:text-foreground",
  );
}

export function railIndicator(
  side: "left" | "right",
  active: boolean,
  current = false,
): string {
  return cn(
    "pointer-events-none absolute w-1 bg-foreground transition-all",
    side === "left" ? "-left-2.5 rounded-r-full" : "-right-2.5 rounded-l-full",
    active ? "h-6" : current ? "h-2" : "h-0 group-hover:h-2",
  );
}

export const RAIL_BADGE =
  "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-background ring-2 ring-chrome tabular-nums";
