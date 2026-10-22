import { FOCUS_RING } from "@/components/ui/focus-ring";
import { cn } from "@/lib/utils";

// UNIT_BOUNDARY_DESCRIPTION: every item of the left and right rails is drawn at one of these sizes, so the rails read as one column of equally sized targets; the Avatar is the size of an Agent's avatar in the expanded sidebar, and SIDEBAR_GLYPH the icons inside its rows.
export const RAIL_GLYPH = 22;
export const RAIL_AVATAR = 36;
export const SIDEBAR_GLYPH = 14;

// UNIT_BOUNDARY_DESCRIPTION: both rails lay their tiles out through these, so an item, the space between items and the padding above them are the same on either side of the page.
export const RAIL_GAP = "gap-3.5";
export const RAIL_COLUMN = `flex flex-col items-center ${RAIL_GAP} py-2`;

// UNIT_BOUNDARY_DESCRIPTION: an expanded row is one tile high and its list leaves one rail gap after it, so a row and a tile are the same distance apart (54) and every icon keeps its place when the pane swaps between its tree and its rail; a tile is as wide as the mark a row draws, the pane's padding short of the pane, so the mark a tile carries is the size of the mark a row carries.
export const RAIL_ROW = "h-10";
// UNIT_BOUNDARY_DESCRIPTION: the rows and tiles of both rails draw one corner shape, a squircle where the browser knows corner-shape and the round corner of border-radius where it does not, which is what every browser drew before.
export const SQUIRCLE = "[corner-shape:squircle]";

// UNIT_BOUNDARY_DESCRIPTION: the item of the page the user is on carries one mark wherever it is drawn, a muted fill inside a hairline with the same corners as a row, so Home reads the same in the tree and in the rail.
export const ACTIVE_ITEM = "bg-muted text-foreground ring-1 ring-border-ui";

// UNIT_BOUNDARY_DESCRIPTION: every row and tile lifts the same way under the pointer, a shade short of the fill the item the user is on carries, so a hover reads as the same gesture wherever it happens.
export const HOVER_ITEM = "hover:bg-muted/60 hover:text-foreground";

// UNIT_BOUNDARY_DESCRIPTION: the tree spends 8 plus 32 on the label above its Agents, and the rail spends the same 40 on the hairline above them, which sits between two of its gaps.
export const RAIL_SEPARATOR_SPACE = "h-3";

export function railTile(active: boolean): string {
  return cn(
    "group relative flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all",
    SQUIRCLE,
    FOCUS_RING,
    active ? ACTIVE_ITEM : HOVER_ITEM,
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
  "absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold text-background ring-2 ring-chrome tabular-nums";
