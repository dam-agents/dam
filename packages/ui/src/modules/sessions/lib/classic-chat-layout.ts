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

export const CLOSED_DOCK = {
  openFilePath: null,
  openFileDirty: false,
  openFileEdit: false,
  openArtifactId: null,
  openArtifactDirty: false,
  openDelegation: null,
  openBrowserAgentId: null,
  openProcessOutputKey: null,
  openChangesAgentId: null,
  sidePanelMaximized: null,
} as const;
