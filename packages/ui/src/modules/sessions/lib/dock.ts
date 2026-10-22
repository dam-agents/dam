import type { SidePanelTab } from "./side-panel.js";

export type Dock =
  | { kind: "file"; path: string; edit: boolean }
  | { kind: "artifact"; id: string; edit: boolean }
  | { kind: "browser"; agentId: string }
  | { kind: "changes"; agentId: string }
  | { kind: "process-output"; key: string }
  | { kind: "delegation"; driverAgentId: string; id: string };

/** UNIT_BOUNDARY_DESCRIPTION: the side panel shows at most one docked item, so the item the person opens names the tab that shows it. */
export const dockTab: Record<Dock["kind"], SidePanelTab> = {
  file: "files",
  artifact: "artifacts",
  browser: "browser",
  changes: "changes",
  "process-output": "processes",
  delegation: "delegation",
};
