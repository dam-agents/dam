import type { BudgetReserved } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { storageRows } from "./pools.js";
import { BYTES_PER_MI, sizeInMi } from "./slots.js";

export interface SidebarPoolRow {
  agent: AgentView | null;
  label: string;
  bytes: number;
}

export interface SidebarPool {
  label: string;
  usedBytes: number;
  totalBytes: number;
  note: string;
  rows: SidebarPoolRow[];
}

export const usageShare = (used: number, total: number) =>
  total > 0 ? Math.min(1, used / total) : 0;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The two pools the sidebar shows, memory and
 * storage, each with what every agent takes of it, largest first. Memory is
 * what vm agents use when a runner reports it, and otherwise what awake
 * container agents reserve by their size. Storage is only measured for vm
 * agents, so without a report it is empty.
 */
export function sidebarPools(
  budget: BudgetReserved,
  agents: readonly AgentView[],
): SidebarPool[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const vm = budget.vm;
  const memory: SidebarPool = vm
    ? {
        label: "Memory",
        usedBytes: vm.memory.usedBytes,
        totalBytes: vm.memory.limitBytes,
        note: "Memory your VM agents use now.",
        rows: vm.agents.flatMap((a) => {
          const agent = byId.get(a.id);
          return agent && a.memoryUsedBytes > 0
            ? [{ agent, label: agent.name, bytes: a.memoryUsedBytes }]
            : [];
        }),
      }
    : {
        label: "Memory",
        usedBytes: budget.memory.reservedBytes,
        totalBytes: budget.memory.ceilingBytes,
        note: "Memory reserved by your awake container agents.",
        rows: agents
          .filter((a) => !a.vm && a.state !== "hibernated" && !a.overBudget)
          .map((agent) => ({
            agent,
            label: agent.name,
            bytes: sizeInMi(agent.size).memoryMi * BYTES_PER_MI,
          }))
          .filter((row) => row.bytes > 0),
      };
  const storage: SidebarPool = vm
    ? {
        label: "Storage",
        usedBytes: vm.storage.usedBytes,
        totalBytes: vm.storage.usableBytes,
        note: "Disk your VM agents and their runner take.",
        rows: storageRows(vm, agents),
      }
    : {
        label: "Storage",
        usedBytes: 0,
        totalBytes: 0,
        note: "Storage is measured for VM agents only.",
        rows: [],
      };
  return [memory, storage].map((pool) => ({
    ...pool,
    rows: [...pool.rows].sort((a, b) => b.bytes - a.bytes),
  }));
}
