import { TRPCError } from "@trpc/server";
import type { BudgetReserved, BudgetsService } from "api-server-api";

export interface BudgetedAgent {
  id: string;
  spec: { resources?: { limits?: Record<string, string> } };
  assignedNode: string | null;
}

export interface BudgetsServiceDeps {
  listAgents(): Promise<BudgetedAgent[]>;
  readCeilingOverride(): Promise<{ cpu: string; memory: string } | null>;
  defaultCeiling: { cpu: string; memory: string };
  slotSize: { cpu: string; memory: string };
}

export class SizeNeverFitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SizeNeverFitsError";
  }
}

export interface SpawnSizeGate {
  assertCanEverFit(limits: { cpu?: string; memory?: string }): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Refuses a Size that could never run, as opposed
 * to one that cannot run yet. Two different things can make a Size impossible
 * and they call for different answers: a Size over the owner's ceiling needs an
 * operator to raise the budget, and one larger than any node's memory needs a
 * bigger node. Waiting helps with neither, so both are refused where the Size
 * is chosen rather than left to a scheduler that will quietly never place it.
 *
 * Only memory is checked against the nodes. A CPU share is a weight on a
 * contended node rather than a reservation, so there is no CPU figure a node
 * is too small to accept.
 */
export function createSpawnSizeGate(
  deps: Pick<BudgetsServiceDeps, "readCeilingOverride" | "defaultCeiling"> & {
    largestNodeMemoryBytes?: () => Promise<number | null>;
  },
): SpawnSizeGate {
  return {
    async assertCanEverFit(limits) {
      const override = await deps.readCeilingOverride();
      const ceiling = override ?? deps.defaultCeiling;
      const cpuMilli = parseCpuMilli(limits.cpu);
      const memoryBytes = parseMemoryBytes(limits.memory);
      const ceilCpu = parseCpuMilli(ceiling.cpu);
      const ceilMemory = parseMemoryBytes(ceiling.memory);
      if (cpuMilli > ceilCpu || memoryBytes > ceilMemory) {
        throw new SizeNeverFitsError(
          `worker size ${cores(cpuMilli)} / ${gi(memoryBytes)} exceeds your budget ceiling ` +
            `${cores(ceilCpu)} / ${gi(ceilMemory)} — it could never start; ` +
            `use a smaller size or ask an operator to raise your budget`,
        );
      }
      const largest = (await deps.largestNodeMemoryBytes?.()) ?? null;
      if (largest !== null && memoryBytes > largest) {
        throw new SizeNeverFitsError(
          `worker size needs ${gi(memoryBytes)} of memory and the largest node in this ` +
            `install has ${gi(largest)} — it could never start; use a smaller size or ` +
            `ask an operator for a bigger node`,
        );
      }
    },
  };
}

export function createBudgetsService(deps: BudgetsServiceDeps): BudgetsService {
  return {
    async reserved(): Promise<BudgetReserved> {
      const [agents, override] = await Promise.all([
        deps.listAgents(),
        deps.readCeilingOverride(),
      ]);
      let cpuMilli = 0;
      let memoryBytes = 0;
      for (const a of agents) {
        if (a.assignedNode === null) continue;
        cpuMilli += parseCpuMilli(a.spec.resources?.limits?.cpu);
        memoryBytes += parseMemoryBytes(a.spec.resources?.limits?.memory);
      }
      const ceiling = override ?? deps.defaultCeiling;
      return {
        cpu: {
          reservedMilli: cpuMilli,
          ceilingMilli: parseCpuMilli(ceiling.cpu),
        },
        memory: {
          reservedBytes: memoryBytes,
          ceilingBytes: parseMemoryBytes(ceiling.memory),
        },
        slot: {
          cpuMilli: parseCpuMilli(deps.slotSize.cpu),
          memoryBytes: parseMemoryBytes(deps.slotSize.memory),
        },
      };
    },
  };
}

const cores = (n: number) => `${(n / 1000).toFixed(1)} CPU`;
const gi = (n: number) => `${(n / 1024 ** 3).toFixed(1)}Gi`;

function parseCpuMilli(q: string | undefined): number {
  if (!q) return 0;
  const s = q.trim();
  const n = s.endsWith("m") ? Number(s.slice(0, -1)) : Number(s) * 1000;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

const MEM_UNITS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

function parseMemoryBytes(q: string | undefined): number {
  if (!q) return 0;
  const m = q.trim().match(/^(\d+(?:\.\d+)?)([A-Za-z]+)?$/);
  if (!m) return 0;
  const factor = m[2] ? (MEM_UNITS[m[2]] ?? 0) : 1;
  return Math.round(Number(m[1]) * factor);
}
