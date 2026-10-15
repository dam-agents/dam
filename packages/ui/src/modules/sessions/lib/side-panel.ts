import {
  browserStorage,
  type KeyValueStore,
  safeGetItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";

export type SidePanelTab =
  "files" | "changes" | "artifacts" | "browser" | "processes" | "delegation";

export type DockedItems = {
  file: boolean;
  artifact: boolean;
  processOutput: boolean;
  changes: boolean;
  browser: boolean;
  delegation: boolean;
};

export type SidePanelAvailability = {
  canOpenBrowser: boolean;
  processesEnabled: boolean;
};

const SIDE_PANEL_TAB_KEY = "platform-side-panel-tab";
const LIST_TABS: readonly SidePanelTab[] = ["files", "artifacts", "processes"];
const COLLAPSED = "none";

export const DEFAULT_SIDE_PANEL_TAB: SidePanelTab = "files";

export function dockedItemTab(docked: DockedItems): SidePanelTab | null {
  if (docked.browser) return "browser";
  if (docked.delegation) return "delegation";
  if (docked.file) return "files";
  if (docked.artifact) return "artifacts";
  if (docked.changes) return "changes";
  if (docked.processOutput) return "processes";
  return null;
}

export function visibleSidePanelTab(
  tab: SidePanelTab | null,
  docked: DockedItems,
  available: SidePanelAvailability,
): SidePanelTab | null {
  switch (tab) {
    case "browser":
      return available.canOpenBrowser && docked.browser ? tab : null;
    case "changes":
      return docked.changes ? tab : null;
    case "delegation":
      return docked.delegation ? tab : null;
    case "processes":
      return available.processesEnabled ? tab : null;
    default:
      return tab;
  }
}

export type SidePanelSelection =
  | { kind: "collapse" }
  | { kind: "open-changes" }
  | { kind: "open-browser" }
  | { kind: "show"; tab: SidePanelTab };

export function selectSidePanelTab(
  tab: SidePanelTab,
  active: SidePanelTab | null,
  docked: DockedItems,
): SidePanelSelection {
  if (tab === active) return { kind: "collapse" };
  if (tab === "changes" && !docked.changes) return { kind: "open-changes" };
  if (tab === "browser" && !docked.browser) return { kind: "open-browser" };
  return { kind: "show", tab };
}

export function readSidePanelTab(
  store: KeyValueStore = browserStorage,
): SidePanelTab | null {
  const raw = safeGetItem(store, SIDE_PANEL_TAB_KEY);
  if (raw === COLLAPSED) return null;
  return LIST_TABS.find((tab) => tab === raw) ?? DEFAULT_SIDE_PANEL_TAB;
}

export function writeSidePanelTab(
  tab: SidePanelTab | null,
  store: KeyValueStore = browserStorage,
): void {
  if (tab === null) safeSetItem(store, SIDE_PANEL_TAB_KEY, COLLAPSED);
  else if (LIST_TABS.includes(tab)) safeSetItem(store, SIDE_PANEL_TAB_KEY, tab);
}
