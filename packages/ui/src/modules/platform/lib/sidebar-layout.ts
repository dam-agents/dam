import type { CSSProperties } from "react";

export const SIDEBAR_COLLAPSED_W = 56;
export const SIDEBAR_DEFAULT_W = 260;
const SIDEBAR_MIN_W = 220;
const SIDEBAR_MAX_W = 520;
export const SIDEBAR_SECTION_MIN_PX = 96;

export function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, width));
}

export function clampAgentsHeight(height: number, totalPx: number): number {
  const max = Math.max(totalPx - SIDEBAR_SECTION_MIN_PX, SIDEBAR_SECTION_MIN_PX);
  return Math.max(SIDEBAR_SECTION_MIN_PX, Math.min(max, height));
}

export function storedAgentsHeight(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

export function agentsSectionStyle(height: number | null): CSSProperties {
  return height === null
    ? { flex: "0 1 auto", maxHeight: "50%", minHeight: 0 }
    : { flex: `0 1 ${height}px`, minHeight: SIDEBAR_SECTION_MIN_PX };
}

export const activitySectionStyle: CSSProperties = {
  flex: "1 1 0",
  minHeight: SIDEBAR_SECTION_MIN_PX,
};
