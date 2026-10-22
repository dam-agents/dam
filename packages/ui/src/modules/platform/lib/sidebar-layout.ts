export const SIDEBAR_COLLAPSED_W = 56;
// UNIT_BOUNDARY_DESCRIPTION: the right rail's width, which is the side panel's bar of tile icons (`w-14`) and nothing else; a pane laid over the page stops exactly where it starts.
export const RIGHT_RAIL_W = 56;
// UNIT_BOUNDARY_DESCRIPTION: the classic icon bar's width, a 48 px button column and its 1 px border; the navigation counts it whenever the Unified right toolbar experiment is off.
export const CLASSIC_RIGHT_RAIL_W = 49;
export const SIDEBAR_DEFAULT_W = 260;
export const SIDEBAR_MIN_W = 220;
const SIDEBAR_MAX_W = 520;

// UNIT_BOUNDARY_DESCRIPTION: how far from the narrowest navigation a drag has to travel before it gives up the navigation altogether, and how far out of the rail it has to travel to bring it back; the same line both ways, so the two gestures cannot disagree.
export const SIDEBAR_SNAP_FRACTION = 0.6;
const SIDEBAR_SNAP_W =
  SIDEBAR_MIN_W - (SIDEBAR_MIN_W - SIDEBAR_COLLAPSED_W) * SIDEBAR_SNAP_FRACTION;

export function clampSidebarWidth(width: number, max = SIDEBAR_MAX_W): number {
  return Math.max(SIDEBAR_MIN_W, Math.min(max, width));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the widest the navigation may be drawn while the page keeps contentMinWidth: the user's own drag stops there, because a drag that squeezed the page would otherwise be what collapsed the navigation under their hand.
 */
export function sidebarMaxWidth({
  viewport,
  rightRailWidth,
  contentMinWidth,
}: {
  viewport: number;
  rightRailWidth: number;
  contentMinWidth: number;
}): number {
  return clampSidebarWidth(viewport - rightRailWidth - contentMinWidth);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: where a drag on the navigation's edge leaves it: past SIDEBAR_SNAP_FRACTION of the way down from its narrowest to the rail it gives up the navigation and the rail takes its place, and the same distance back out of the rail opens it again at the dragged width; anywhere else it holds the width, within its own range.
 */
export function snapSidebarWidth(
  width: number,
  max = SIDEBAR_MAX_W,
): number | "rail" {
  return width < SIDEBAR_SNAP_W ? "rail" : clampSidebarWidth(width, max);
}
