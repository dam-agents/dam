import type { AgentView } from "../../../types.js";

export interface TemporarySandboxSplit {
  visible: AgentView[];
  temporaryCountByDriver: Map<string, number>;
}

export function splitTemporarySandboxes(
  agents: AgentView[],
): TemporarySandboxSplit {
  const visible: AgentView[] = [];
  const temporaryCountByDriver = new Map<string, number>();

  for (const agent of agents) {
    if (agent.spawnedBy === null) {
      visible.push(agent);
      continue;
    }
    if (
      agent.state !== "running" &&
      agent.state !== "starting" &&
      agent.state !== "preparing_workspace"
    )
      continue;
    temporaryCountByDriver.set(
      agent.spawnedBy,
      (temporaryCountByDriver.get(agent.spawnedBy) ?? 0) + 1,
    );
  }
  return { visible, temporaryCountByDriver };
}
