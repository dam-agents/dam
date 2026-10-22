export const SIDEBAR_COLLAPSED_W = 56;
export const SIDEBAR_DEFAULT_W = 260;
const SIDEBAR_MIN_W = 220;
const SIDEBAR_MAX_W = 520;

export function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, width));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A drag of the sidebar edge keeps the edge under
 * the pointer. Past a bound the width stops while the pointer goes on, and on
 * the way back the width changes only once the pointer is over the bound
 * again. `reached` is where the pointer has taken the edge so far in this
 * drag, past the bounds included.
 */
export function dragSidebarWidth(
  reached: number,
  delta: number,
): { reached: number; width: number } {
  const next = reached + delta;
  return { reached: next, width: clampSidebarWidth(next) };
}
