import type { AgentView } from "../../../types.js";
import { parseCpuMilli, parseMemoryMi } from "../../sandboxes/lib/quantity.js";

export interface TemporaryDraw {
  count: number;
  cpuMilli: number;
  memoryMi: number;
}

export interface TemporarySandboxSplit {
  /** Everything the user created, in the input order. */
  visible: AgentView[];
  /** Live compute of hidden targets, keyed by the driver that spawned them. */
  drawByDriver: Map<string, TemporaryDraw>;
}

/** Split Invocation targets (`spawnedBy` set) out of the agents list and
 *  attribute their compute to the driver that spawned them. Targets are
 *  run-owned and ephemeral — they inherit the driver's config and are reaped
 *  when the run ends — so listing them as peers is noise, but their pods draw
 *  real CPU/memory the list must still explain. Only targets whose pod is up
 *  (or coming up) count toward the draw; hidden either way. */
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

/** "using 2.5 cores, 6 Gi" — omitting a dimension nothing reported. */
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
