import type { SidePanelTab } from "./side-panel.js";

export const LEFT_MIN_W = 240;
const LEFT_MAX_W = 400;
const CHAT_MIN_W = 320;
const PANEL_MIN_W = 320;

export function clampLeftWidth(width: number): number {
  return Math.max(LEFT_MIN_W, Math.min(LEFT_MAX_W, width));
}

export interface ClassicColumns {
  panelFills: boolean;
  panelMaxW: number | null;
  panelW: number | null;
}

export function classicColumns({
  columnsW,
  leftW,
  savedPanelW,
  panelOpen,
  panelMaximized,
}: {
  columnsW: number | null;
  leftW: number;
  savedPanelW: number | null;
  panelOpen: boolean;
  panelMaximized: boolean;
}): ClassicColumns {
  const doNotFit =
    columnsW !== null && columnsW < leftW + CHAT_MIN_W + PANEL_MIN_W;
  const panelMaxW = columnsW === null ? null : columnsW - leftW - CHAT_MIN_W;
  return {
    panelFills: panelMaximized || (panelOpen && doNotFit),
    panelMaxW,
    panelW:
      savedPanelW !== null && panelMaxW !== null
        ? Math.min(savedPanelW, Math.max(PANEL_MIN_W, panelMaxW))
        : savedPanelW,
  };
}

export type ClassicAppTab = Extract<
  SidePanelTab,
  "approvals" | "getting-started"
>;

export type ClassicPanel = "dock" | ClassicAppTab;

export function classicAppTab(
  tab: SidePanelTab | null,
  hidden: ReadonlySet<SidePanelTab>,
): ClassicAppTab | null {
  return (tab === "approvals" || tab === "getting-started") && !hidden.has(tab)
    ? tab
    : null;
}

export function classicPanel(
  tab: SidePanelTab | null,
  hidden: ReadonlySet<SidePanelTab>,
  docked: boolean,
): ClassicPanel | null {
  return classicAppTab(tab, hidden) ?? (docked ? "dock" : null);
}

export type ClassicDockToggle = "reveal" | "close" | "open";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a top-bar toggle of the classic chat (browser,
 * changes) reads what the slot shows. Its item shown in the slot is pressed and
 * closes; its item docked behind an app panel (Approvals, Get started), or
 * hidden on a phone, is not pressed and comes back to view; an item not docked
 * opens.
 */
export function classicDockToggle({
  docked,
  front,
  panel,
  hiddenOnPhone,
}: {
  docked: boolean;
  front: boolean;
  panel: ClassicPanel | null;
  hiddenOnPhone: boolean;
}): { pressed: boolean; click: ClassicDockToggle } {
  if (!docked) return { pressed: false, click: "open" };
  const shown = front && panel === "dock" && !hiddenOnPhone;
  return shown
    ? { pressed: true, click: "close" }
    : { pressed: false, click: "reveal" };
}
