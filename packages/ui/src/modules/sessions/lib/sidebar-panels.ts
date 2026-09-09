import type { CSSProperties } from "react";

export type SidebarPanelId = "sessions" | "files" | "artifacts";

export type PanelWeights = Record<SidebarPanelId, number>;

export type SidebarPanel = { id: SidebarPanelId; open: boolean };

export type DividerPair = { above: SidebarPanelId; below: SidebarPanelId };

export type PanelMeasure = { weight: number; px: number };

const MIN_PANEL_PX = 120;
const COLLAPSED_PANEL_PX = 44;
export const DEFAULT_PANEL_WEIGHT = 1;

export function dividerPairs(panels: readonly SidebarPanel[]): DividerPair[] {
  const pairs: DividerPair[] = [];
  let above: SidebarPanelId | null = null;
  for (const panel of panels) {
    if (!panel.open) continue;
    if (above !== null) pairs.push({ above, below: panel.id });
    above = panel.id;
  }
  return pairs;
}

export function panelStyle(open: boolean, weight: number): CSSProperties {
  return open
    ? { flexGrow: weight, flexBasis: 0, minHeight: 0 }
    : { flex: `0 0 ${COLLAPSED_PANEL_PX}px` };
}

export function panelWeightOrDefault(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PANEL_WEIGHT;
}

export function resizePair(
  above: PanelMeasure,
  below: PanelMeasure,
  deltaPx: number,
): { above: number; below: number } {
  const unchanged = { above: above.weight, below: below.weight };
  const totalPx = above.px + below.px;
  if (totalPx <= 0) return unchanged;

  const smallestDelta = MIN_PANEL_PX - above.px;
  const largestDelta = below.px - MIN_PANEL_PX;
  if (largestDelta < smallestDelta) return unchanged;

  const delta = Math.min(largestDelta, Math.max(smallestDelta, deltaPx));
  const totalWeight = above.weight + below.weight;
  const aboveWeight = (totalWeight * (above.px + delta)) / totalPx;
  return { above: aboveWeight, below: totalWeight - aboveWeight };
}
