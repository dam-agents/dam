export const SIDEBAR_COLLAPSED_W = 56;
export const SIDEBAR_DEFAULT_W = 260;
const SIDEBAR_MIN_W = 220;
const SIDEBAR_MAX_W = 520;

export function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, width));
}
