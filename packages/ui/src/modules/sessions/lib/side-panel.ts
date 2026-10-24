export type SidePanelTab =
  | "files"
  | "changes"
  | "artifacts"
  | "browser"
  | "processes"
  | "environments"
  | "connections"
  | "channels"
  | "skills"
  | "schedules"
  | "agent"
  | "providers"
  | "network"
  | "environment"
  | "chat-forms"
  | "documentation"
  | "delegation"
  | "getting-started"
  | "approvals";

export type DockedItems = {
  file: boolean;
  artifact: boolean;
  processOutput: boolean;
  changes: boolean;
  browser: boolean;
  delegation: boolean;
};

export const NOTHING_DOCKED: DockedItems = {
  file: false,
  artifact: false,
  processOutput: false,
  changes: false,
  browser: false,
  delegation: false,
};

export type SidePanelAvailability = {
  agent: boolean;
  artifacts: boolean;
  canOpenBrowser: boolean;
  changes: boolean;
  processesEnabled: boolean;
  environments: boolean;
  configuration: boolean;
  gettingStarted: boolean;
};

export function hiddenSidePanelTabs(
  available: SidePanelAvailability,
): ReadonlySet<SidePanelTab> {
  const shown: Record<SidePanelTab, boolean> = {
    artifacts: available.artifacts,
    files: available.agent,
    changes: available.agent && available.changes,
    delegation: available.agent,
    browser: available.agent && available.canOpenBrowser,
    processes: available.agent && available.processesEnabled,
    environments: available.agent && available.environments,
    connections: available.agent && available.configuration,
    channels: available.agent && available.configuration,
    skills: available.agent && available.configuration,
    schedules: available.agent && available.configuration,
    agent: available.agent && available.configuration,
    providers: available.agent && available.configuration,
    network: available.agent && available.configuration,
    environment: available.agent && available.configuration,
    "chat-forms": available.agent && available.configuration,
    documentation: available.configuration,
    "getting-started": available.gettingStarted,
    approvals: true,
  };
  return new Set(
    (Object.keys(shown) as SidePanelTab[]).filter((tab) => !shown[tab]),
  );
}

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
  hidden: ReadonlySet<SidePanelTab>,
): SidePanelTab | null {
  if (tab === null || hidden.has(tab)) return null;
  switch (tab) {
    case "browser":
      return docked.browser ? tab : null;
    case "changes":
      return docked.changes ? tab : null;
    case "delegation":
      return docked.delegation ? tab : null;
    default:
      return tab;
  }
}

import type { SandboxSection } from "../../platform/lib/routes.js";

export type ConfigurationTab = Extract<
  SidePanelTab,
  | "agent"
  | "connections"
  | "channels"
  | "skills"
  | "schedules"
  | "environments"
  | "providers"
  | "network"
  | "environment"
  | "chat-forms"
>;

const SECTION_TAB: Record<SandboxSection, ConfigurationTab> = {
  setup: "agent",
  providers: "providers",
  connections: "connections",
  network: "network",
  environment: "environment",
  channels: "channels",
  "chat-forms": "chat-forms",
  skills: "skills",
  schedules: "schedules",
  environments: "environments",
  usage: "agent",
};

export function configTabForSection(section: SandboxSection): ConfigurationTab {
  return SECTION_TAB[section];
}

export const CONFIGURATION_TABS: readonly ConfigurationTab[] = [
  "agent",
  "connections",
  "channels",
  "skills",
  "schedules",
  "environments",
  "providers",
  "network",
  "environment",
  "chat-forms",
];

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
