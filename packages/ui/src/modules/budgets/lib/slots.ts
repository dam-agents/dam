import type { BudgetReserved } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { parseCpuMilli, parseMemoryMi } from "../../sandboxes/lib/quantity.js";
import { formatCores, formatGi } from "./format.js";

const BYTES_PER_MI = 1024 ** 2;

export interface SlotUnit {
  cpuMilli: number;
  memoryMi: number;
}

export interface SizeMi {
  cpuMilli: number;
  memoryMi: number;
}

export const SIZE_MULTIPLIERS = [1, 2, 4] as const;

export function slotUnitOf(budget: BudgetReserved): SlotUnit {
  return {
    cpuMilli: Math.max(1, budget.slot.cpuMilli),
    memoryMi: Math.max(1, Math.round(budget.slot.memoryBytes / BYTES_PER_MI)),
  };
}

export function sizeInMi(size: { cpu?: string; memory?: string }): SizeMi {
  return {
    cpuMilli: parseCpuMilli(size.cpu) ?? 0,
    memoryMi: parseMemoryMi(size.memory) ?? 0,
  };
}

export function sizeForMultiplier(unit: SlotUnit, multiplier: number): SizeMi {
  return {
    cpuMilli: unit.cpuMilli * multiplier,
    memoryMi: unit.memoryMi * multiplier,
  };
}

export function sizeMultiplier(size: SizeMi, unit: SlotUnit): number {
  const ratio = Math.max(
    size.cpuMilli / unit.cpuMilli,
    size.memoryMi / unit.memoryMi,
  );
  return ratio > 0 ? ratio : 1;
}

export function slotsFor(size: SizeMi, unit: SlotUnit): number {
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

export function freeSlots(
  budget: BudgetReserved,
  unit: SlotUnit,
  ownReserved: SizeMi = { cpuMilli: 0, memoryMi: 0 },
): number {
  return Math.max(
    0,
    Math.min(
      Math.floor(
        (budget.cpu.ceilingMilli -
          budget.cpu.reservedMilli +
          ownReserved.cpuMilli) /
          unit.cpuMilli,
      ),
      Math.floor(
        ((budget.memory.ceilingBytes - budget.memory.reservedBytes) /
          BYTES_PER_MI +
          ownReserved.memoryMi) /
          unit.memoryMi,
      ),
    ),
  );
}

export function formatMultiplier(size: SizeMi, unit: SlotUnit): string {
  return `${String(Number(sizeMultiplier(size, unit).toFixed(2)))}x`;
}

export function formatSizeLabel(size: SizeMi, unit: SlotUnit): string {
  return `${formatMultiplier(size, unit)} · ${formatCores(size.cpuMilli)} CPU · ${formatGi(
    size.memoryMi * BYTES_PER_MI,
  )} Gi`;
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
  cpuMilli: number;
  memoryMi: number;
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
      cpuMilli: rows.reduce((sum, r) => sum + r.cpuMilli, 0),
      memoryMi: rows.reduce((sum, r) => sum + r.memoryMi, 0),
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
