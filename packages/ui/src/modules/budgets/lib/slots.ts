import type { BudgetReserved } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { parseCpuMilli, parseMemoryMi } from "../../sandboxes/lib/quantity.js";

const BYTES_PER_MI = 1024 ** 2;

export interface SlotUnit {
  cpuMilli: number;
  memoryMi: number;
}

interface SizeMi {
  cpuMilli: number;
  memoryMi: number;
}

export function slotUnitOf(budget: BudgetReserved): SlotUnit {
  return {
    cpuMilli: Math.max(1, budget.slot.cpuMilli),
    memoryMi: Math.max(1, Math.round(budget.slot.memoryBytes / BYTES_PER_MI)),
  };
}

function sizeInMi(size: { cpu?: string; memory?: string }): SizeMi {
  return {
    cpuMilli: parseCpuMilli(size.cpu) ?? 0,
    memoryMi: parseMemoryMi(size.memory) ?? 0,
  };
}

function sizeMultiplier(size: SizeMi, unit: SlotUnit): number {
  const ratio = Math.max(
    size.cpuMilli / unit.cpuMilli,
    size.memoryMi / unit.memoryMi,
  );
  return ratio > 0 ? ratio : 1;
}

function slotsFor(size: SizeMi, unit: SlotUnit): number {
  return Math.max(1, Math.ceil(sizeMultiplier(size, unit) - 1e-9));
}

export function ceilingSlots(budget: BudgetReserved, unit: SlotUnit): number {
  return Math.max(
    0,
    Math.min(
      Math.floor(budget.cpu.ceilingMilli / unit.cpuMilli),
      Math.floor(budget.memory.ceilingBytes / BYTES_PER_MI / unit.memoryMi),
    ),
  );
}

export type ComputeCellState = "running" | "awake" | "available";

export interface ComputeSegment {
  state: ComputeCellState;
  agentId: string | null;
  agentName: string | null;
  cpuMilli: number;
  memoryMi: number;
  slots: number;
}

export interface ComputeGroup {
  state: Exclude<ComputeCellState, "available">;
  agents: number;
  slots: number;
}

export interface ComputeView {
  segments: ComputeSegment[];
  usedSlots: number;
  ceilingSlots: number;
  totalSlots: number;
  groups: ComputeGroup[];
}

export function computeView(
  runningAgents: readonly AgentView[],
  workingAgentIds: ReadonlySet<string>,
  budget: BudgetReserved,
): ComputeView {
  const unit = slotUnitOf(budget);
  const held = runningAgents.map((agent) => {
    const size = sizeInMi(agent.size);
    return {
      agent,
      ...size,
      slots: slotsFor(size, unit),
      state: (workingAgentIds.has(agent.id) ? "running" : "awake") as Exclude<
        ComputeCellState,
        "available"
      >,
    };
  });

  const ordered = [
    ...held.filter((h) => h.state === "running"),
    ...held.filter((h) => h.state === "awake"),
  ];

  const segments: ComputeSegment[] = ordered.map((entry) => ({
    state: entry.state,
    agentId: entry.agent.id,
    agentName: entry.agent.name,
    cpuMilli: entry.cpuMilli,
    memoryMi: entry.memoryMi,
    slots: entry.slots,
  }));

  const usedSlots = held.reduce((sum, h) => sum + h.slots, 0);
  const ceiling = ceilingSlots(budget, unit);
  const totalSlots = Math.max(usedSlots, ceiling);
  if (totalSlots > usedSlots) {
    segments.push({
      state: "available",
      agentId: null,
      agentName: null,
      cpuMilli: 0,
      memoryMi: 0,
      slots: totalSlots - usedSlots,
    });
  }

  const groupFor = (
    state: Exclude<ComputeCellState, "available">,
  ): ComputeGroup => {
    const rows = held.filter((h) => h.state === state);
    return {
      state,
      agents: rows.length,
      slots: rows.reduce((sum, r) => sum + r.slots, 0),
    };
  };

  return {
    segments,
    usedSlots,
    ceilingSlots: ceiling,
    totalSlots,
    groups: [groupFor("running"), groupFor("awake")].filter(
      (g) => g.agents > 0,
    ),
  };
}

export interface Consumer {
  agentId: string;
  agentName: string;
  memoryBytes: number;
  cpuMilli: number | null;
  working: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Ranks running agents by what they are measured to
 * be using — the answer to "which of mine should I stop", now that nobody
 * chooses an agent's size and there is no reservation to compare them by.
 *
 * Memory orders the list because it is the figure that is actually finite. CPU
 * is a share of whatever is spare, so it reads as near zero for an agent
 * between turns, which is most agents most of the time, and ordering by it
 * would rank by who happened to be mid-sentence.
 */
export function consumers(
  runningAgents: readonly AgentView[],
  workingAgentIds: ReadonlySet<string>,
): Consumer[] {
  return runningAgents
    .map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      memoryBytes: agent.usage?.memoryBytes ?? 0,
      cpuMilli: agent.usage?.cpuMilli ?? null,
      working: workingAgentIds.has(agent.id),
    }))
    .sort(
      (a, b) =>
        b.memoryBytes - a.memoryBytes || (b.cpuMilli ?? 0) - (a.cpuMilli ?? 0),
    );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: How far a user's share of a busy node has been
 * tilted away from an even split by their own recent use, as a percentage, or
 * null when it has not been. The node writes that weight and the agents report
 * it back, so this only has to notice that it is no longer the default.
 *
 * The lowest of a user's agents is the one to show. They are all in the same
 * group on any one node, so a difference between them means they are on
 * different nodes — and the honest answer to "how am I being treated" is the
 * worst of the places the user is being treated.
 */
const DEFAULT_SHARE_WEIGHT = 100;

export function shareTilt(runningAgents: readonly AgentView[]): number | null {
  const weights = runningAgents.flatMap((a) =>
    typeof a.usage?.shareWeight === "number" ? [a.usage.shareWeight] : [],
  );
  if (weights.length === 0) return null;
  const lowest = Math.min(...weights);
  return lowest >= DEFAULT_SHARE_WEIGHT ? null : lowest;
}
