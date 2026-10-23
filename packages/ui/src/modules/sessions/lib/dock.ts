import type { SidePanelTab } from "./side-panel.js";

export type Dock =
  | { kind: "file"; path: string }
  | { kind: "artifact"; id: string }
  | { kind: "browser"; agentId: string }
  | { kind: "changes"; agentId: string }
  | { kind: "process-output"; key: string }
  | { kind: "delegation"; driverAgentId: string; id: string };

/** UNIT_BOUNDARY_DESCRIPTION: the item a dock holds, one string per item, so two docks of the same thing compare equal. */
export function dockKey(dock: Dock | null): string | null {
  if (dock === null) return null;
  switch (dock.kind) {
    case "file":
      return `file:${dock.path}`;
    case "artifact":
      return `artifact:${dock.id}`;
    case "browser":
      return `browser:${dock.agentId}`;
    case "changes":
      return `changes:${dock.agentId}`;
    case "process-output":
      return `process-output:${dock.key}`;
    case "delegation":
      return `delegation:${dock.driverAgentId}:${dock.id}`;
  }
}

/** UNIT_BOUNDARY_DESCRIPTION: the side panel shows at most one docked item, so the item the person opens names the tab that shows it. */
export const dockTab: Record<Dock["kind"], SidePanelTab> = {
  file: "files",
  artifact: "artifacts",
  browser: "browser",
  changes: "changes",
  "process-output": "processes",
  delegation: "delegation",
};
