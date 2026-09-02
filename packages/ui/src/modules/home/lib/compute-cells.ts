import type { AgentView } from "../../../types.js";
import { parseCpuMilli, parseMemoryMi } from "../../sandboxes/lib/quantity.js";

export type ComputeCellState = "running" | "awake" | "available";

export interface ComputeCell {
  state: ComputeCellState;
  agentId: string | null;
  agentName: string | null;
  cpuMilli: number;
  memoryMi: number;
  alwaysOn: boolean;
}

export interface ComputeGroup {
  state: Exclude<ComputeCellState, "available">;
  agents: number;
  cpuMilli: number;
  memoryMi: number;
}

export interface ComputeView {
  cells: ComputeCell[];
  usedMilli: number;
  ceilingMilli: number;
  groups: ComputeGroup[];
}

const MILLI_PER_CORE = 1000;

function cellsFor(cpuMilli: number): number {
  return Math.max(1, Math.round(cpuMilli / MILLI_PER_CORE));
}

export function computeView(
  runningAgents: readonly AgentView[],
  workingAgentIds: ReadonlySet<string>,
  ceilingMilli: number,
): ComputeView {
  const held = runningAgents.map((agent) => ({
    agent,
    cpuMilli: parseCpuMilli(agent.size.cpu) ?? 0,
    memoryMi: parseMemoryMi(agent.size.memory) ?? 0,
    state: (workingAgentIds.has(agent.id) ? "running" : "awake") as Exclude<
      ComputeCellState,
      "available"
    >,
  }));

  const ordered = [
    ...held.filter((h) => h.state === "running"),
    ...held.filter((h) => h.state === "awake"),
  ];

  const cells: ComputeCell[] = [];
  for (const entry of ordered) {
    for (let i = 0; i < cellsFor(entry.cpuMilli); i++) {
      cells.push({
        state: entry.state,
        agentId: entry.agent.id,
        agentName: entry.agent.name,
        cpuMilli: entry.cpuMilli,
        memoryMi: entry.memoryMi,
        alwaysOn: entry.agent.hibernationTimeoutMin === 0,
      });
    }
  }

  const total = Math.max(
    cells.length,
    Math.round(ceilingMilli / MILLI_PER_CORE),
  );
  while (cells.length < total) {
    cells.push({
      state: "available",
      agentId: null,
      agentName: null,
      cpuMilli: 0,
      memoryMi: 0,
      alwaysOn: false,
    });
  }

  const groupFor = (
    state: Exclude<ComputeCellState, "available">,
  ): ComputeGroup => {
    const rows = held.filter((h) => h.state === state);
    return {
      state,
      agents: rows.length,
      cpuMilli: rows.reduce((sum, r) => sum + r.cpuMilli, 0),
      memoryMi: rows.reduce((sum, r) => sum + r.memoryMi, 0),
    };
  };

  return {
    cells,
    usedMilli: held.reduce((sum, h) => sum + h.cpuMilli, 0),
    ceilingMilli,
    groups: [groupFor("running"), groupFor("awake")].filter(
      (g) => g.agents > 0,
    ),
  };
}
