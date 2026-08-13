import type { AgentView } from "../../../types.js";
import { parseCpuMilli, parseMemoryMi } from "../../sandboxes/lib/quantity.js";

export interface TemporaryDraw {
  count: number;
  cpuMilli: number;
  memoryMi: number;
}

export interface TemporarySandboxSplit {
  visible: AgentView[];
  drawByDriver: Map<string, TemporaryDraw>;
}

export function splitTemporarySandboxes(
  agents: AgentView[],
): TemporarySandboxSplit {
  const visible: AgentView[] = [];
  const drawByDriver = new Map<string, TemporaryDraw>();

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
    const draw = drawByDriver.get(agent.spawnedBy) ?? {
      count: 0,
      cpuMilli: 0,
      memoryMi: 0,
    };
    draw.count += 1;
    draw.cpuMilli += parseCpuMilli(agent.size.cpu) ?? 0;
    draw.memoryMi += parseMemoryMi(agent.size.memory) ?? 0;
    drawByDriver.set(agent.spawnedBy, draw);
  }
  return { visible, drawByDriver };
}

export function formatTemporaryDraw(draw: TemporaryDraw): string {
  const parts: string[] = [];
  if (draw.cpuMilli > 0) {
    const cores = draw.cpuMilli / 1000;
    parts.push(
      `${Number.isInteger(cores) ? cores : cores.toFixed(1)} core${cores === 1 ? "" : "s"}`,
    );
  }
  if (draw.memoryMi > 0) {
    const gi = draw.memoryMi / 1024;
    parts.push(`${Number.isInteger(gi) ? gi : gi.toFixed(1)} Gi`);
  }
  return parts.length > 0 ? `using ${parts.join(", ")}` : "";
}
