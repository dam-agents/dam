import type { SidePanelTab } from "./side-panel.js";

export const LEFT_MIN_W = 240;
const LEFT_MAX_W = 400;
const CHAT_MIN_W = 320;
export const PANEL_MIN_W = 320;

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

export type ClassicAppTab = Extract<SidePanelTab, "approvals">;

export function classicAppTab(
  tab: SidePanelTab | null,
  hidden: ReadonlySet<SidePanelTab>,
): ClassicAppTab | null {
  return tab === "approvals" && !hidden.has(tab) ? tab : null;
}

export function classicPanel(docked: boolean): "dock" | null {
  return docked ? "dock" : null;
}

export type ClassicDockToggle = "reveal" | "close" | "open";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a top-bar toggle of the classic chat (browser,
 * changes) reads what the slot shows. Its item shown in the slot is pressed and
 * closes; its item hidden on a phone is not pressed and comes back to view; an
 * item not docked, or covered by a docked item, opens in front. Approvals is a
 * drawer over the chat and Get started a dock below the top bar, so neither
 * takes the slot and the docked item stays in view.
 */
export function classicDockToggle({
  docked,
  front,
  panel,
  hiddenOnPhone,
}: {
  docked: boolean;
  front: boolean;
  panel: "dock" | null;
  hiddenOnPhone: boolean;
}): { pressed: boolean; click: ClassicDockToggle } {
  if (!docked || !front) return { pressed: false, click: "open" };
  const shown = panel === "dock" && !hiddenOnPhone;
  return shown
    ? { pressed: true, click: "close" }
    : { pressed: false, click: "reveal" };
}
