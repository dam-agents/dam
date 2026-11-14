import type { SidePanelTab } from "./side-panel.js";
import type { SidebarPanel, SidebarPanelId } from "./sidebar-panels.js";

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
 * drawer over the chat, so it never takes the slot and the docked item stays in
 * view.
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

export interface SectionsColumn {
  shown: SidebarPanelId[];
  open: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: which of the Files, Artifacts and Processes
 * sections the column beside the conversation draws. On a desktop each section
 * opens from its top-bar icon and closes with its X, so the column draws only
 * the open ones and is gone while none is open, leaving the conversation the
 * width. A phone shows the column as a screen of its own, so it draws every
 * section there, each one folding from its header.
 */
export function sectionsColumn(
  sections: readonly SidebarPanel[],
  desktop: boolean,
): SectionsColumn {
  const opened = sections.filter((s) => s.open).map((s) => s.id);
  return desktop
    ? { shown: opened, open: opened.length > 0 }
    : { shown: sections.map((s) => s.id), open: true };
}
