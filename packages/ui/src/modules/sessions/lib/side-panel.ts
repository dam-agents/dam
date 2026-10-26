import type { SandboxSection } from "../../platform/lib/routes.js";

export type SidePanelTab =
  | "files"
  | "changes"
  | "artifacts"
  | "browser"
  | "processes"
  | "environments"
  | "models"
  | "services"
  | "skills"
  | "automations"
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
    models: available.agent && available.configuration,
    services: available.agent && available.configuration,
    skills: available.agent && available.configuration,
    automations: available.agent && available.configuration,
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

export type ConfigurationTab = Extract<
  SidePanelTab,
  "models" | "services" | "skills" | "automations" | "environments"
>;

/* UNIT_BOUNDARY_DESCRIPTION: each of the page's sections opens the tile that
 * holds it, so an address the page had still lands on what it named: General,
 * Chat forms and Usage open Models, which owns the providers and the spending;
 * the channels and the schedules share Automations. */
const SECTION_TAB: Record<SandboxSection, ConfigurationTab> = {
  setup: "models",
  people: "models",
  providers: "models",
  connections: "services",
  network: "services",
  environment: "services",
  "chat-forms": "models",
  channels: "automations",
  skills: "skills",
  schedules: "automations",
  environments: "environments",
  usage: "models",
};

export function configTabForSection(section: SandboxSection): ConfigurationTab {
  return SECTION_TAB[section];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: which panel a configuration address opens, or
 * none: only the install's flag turns the page's own address into the panel
 * that holds its section, so a browser that last stored the experiment on
 * never redirects a page the install says is off. People arrived after the
 * panels did and no panel renders it, so under the flag that one section keeps
 * the page of its own rather than bouncing to a panel that would drop it.
 */
export function configRedirectTab(
  flag: boolean,
  section: SandboxSection,
): ConfigurationTab | null {
  if (section === "people") return null;
  return flag ? configTabForSection(section) : null;
}

export const CONFIGURATION_TABS: readonly ConfigurationTab[] = [
  "models",
  "services",
  "skills",
  "automations",
  "environments",
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
