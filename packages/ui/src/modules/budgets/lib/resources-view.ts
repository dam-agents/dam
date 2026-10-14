import type { AgentView } from "../../../types.js";

export type ResourcesView = "vm" | "container";

export const RESOURCES_VIEW_KEY = "home.resources-view";

// UNIT_BOUNDARY_DESCRIPTION: which view of the home dashboard's resources card shows, and whether the switch between them does. Only a user with both kinds of agent gets the switch; their remembered choice wins, else the vm view. Anyone else sees the one view their agents have, the container view when they have none.
export function resourcesView(
  agents: readonly AgentView[],
  remembered: string | null,
): { view: ResourcesView; switchable: boolean } {
  const vm = agents.some((agent) => agent.vm);
  const container = agents.some((agent) => !agent.vm);
  if (!vm || !container)
    return { view: vm ? "vm" : "container", switchable: false };
  return {
    view: remembered === "vm" || remembered === "container" ? remembered : "vm",
    switchable: true,
  };
}
