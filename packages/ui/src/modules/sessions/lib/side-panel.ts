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

export const SIDE_PANEL_MIN_W = 280;
const VIEW_MIN_W: Partial<Record<SidePanelTab, number>> = { browser: 480 };

export function sidePanelMinWidth(tab: SidePanelTab | null): number {
  return (tab && VIEW_MIN_W[tab]) ?? SIDE_PANEL_MIN_W;
}

export function shownSidePanelWidth(
  saved: number,
  min: number,
  max: number | null,
): number {
  const wanted = Math.max(saved, min);
  return max === null ? wanted : Math.min(wanted, Math.max(min, max));
}

export function maximizableView(
  activeTab: SidePanelTab | null,
  dockedShown: boolean,
  openFilePath: string | null,
  openArtifactId: string | null,
): string | null {
  if (activeTab === "browser") return "browser";
  if (activeTab === "files" && dockedShown && openFilePath)
    return `file:${openFilePath}`;
  if (activeTab === "artifacts" && dockedShown && openArtifactId)
    return `artifact:${openArtifactId}`;
  return null;
}
