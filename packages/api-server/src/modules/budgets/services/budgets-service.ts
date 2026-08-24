import { TRPCError } from "@trpc/server";
import type { BudgetReserved, BudgetsService } from "api-server-api";

export interface BudgetedAgent {
  id: string;
  spec: { resources?: { limits?: Record<string, string> } };
  hibernated: boolean;
  overBudget: boolean;
}

export interface BudgetsServiceDeps {
  listAgents(): Promise<BudgetedAgent[]>;
  readCeilingOverride(): Promise<{ cpu: string; memory: string } | null>;
  defaultCeiling: { cpu: string; memory: string };
}

export interface ResizeGate {
  assertResizeFits(
    agent: BudgetedAgent,
    newSize: { cpu?: string; memory?: string },
  ): Promise<void>;
}

export function createResizeGate(deps: BudgetsServiceDeps): ResizeGate {
  return {
    async assertResizeFits(agent, newSize) {
      const current = agent.spec.resources?.limits;
      const newCpu = parseCpuMilli(newSize.cpu ?? current?.cpu);
      const newMemory = parseMemoryBytes(newSize.memory ?? current?.memory);
      if (
        newCpu <= parseCpuMilli(current?.cpu) &&
        newMemory <= parseMemoryBytes(current?.memory)
      ) {
        return;
      }
      const [agents, override] = await Promise.all([
        deps.listAgents(),
        deps.readCeilingOverride(),
      ]);
      const ceiling = override ?? deps.defaultCeiling;
      let cpuMilli = 0;
      let memoryBytes = 0;
      for (const a of agents) {
        if (a.id === agent.id || a.hibernated || a.overBudget) continue;
        cpuMilli += parseCpuMilli(a.spec.resources?.limits?.cpu);
        memoryBytes += parseMemoryBytes(a.spec.resources?.limits?.memory);
      }
      const totalCpu = cpuMilli + newCpu;
      const totalMemory = memoryBytes + newMemory;
      const ceilCpu = parseCpuMilli(ceiling.cpu);
      const ceilMemory = parseMemoryBytes(ceiling.memory);
      if (totalCpu > ceilCpu || totalMemory > ceilMemory) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `This size would take your running agents to ${cores(totalCpu)}/${cores(ceilCpu)} ` +
            `and ${gi(totalMemory)}/${gi(ceilMemory)} memory — pause, stop, or shrink another agent first.`,
        });
      }
    },
  };
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

export function createSpawnSizeGate(
  deps: Pick<BudgetsServiceDeps, "readCeilingOverride" | "defaultCeiling">,
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
        if (a.hibernated || a.overBudget) continue;
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
