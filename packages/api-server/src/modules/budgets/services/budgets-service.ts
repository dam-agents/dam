import { TRPCError } from "@trpc/server";
import type { BudgetReserved, BudgetsService } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { parseCpuMilli, parseMemoryBytes } from "../../../core/quantities.js";
import {
  storageRefusal,
  vmUsageView,
  type RunnerUsage,
} from "../domain/vm-usage.js";

export interface BudgetedAgent {
  id: string;
  spec: {
    resources?: { limits?: Record<string, string> };
    backend?: { type?: string };
  };
  hibernated: boolean;
  overBudget: boolean;
}

export type CeilingOverride = Partial<{ cpu: string; memory: string }>;

interface BudgetsServiceDeps {
  listAgents(): Promise<BudgetedAgent[]>;
  readCeilingOverride(): Promise<CeilingOverride | null>;
  defaultCeiling: { cpu: string; memory: string };
  slotSize: { cpu: string; memory: string };
  readVmUsage(): Promise<RunnerUsage | null>;
  isSlackUnlinked(): Promise<boolean>;
}

export interface ResizeGate {
  assertResizeFits(
    agent: BudgetedAgent,
    newSize: { cpu?: string; memory?: string },
  ): Promise<void>;
}

export function createResizeGate(
  deps: Omit<
    BudgetsServiceDeps,
    "slotSize" | "readVmUsage" | "isSlackUnlinked"
  >,
): ResizeGate {
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
      const ceiling = { ...deps.defaultCeiling, ...override };
      const { cpuMilli, memoryBytes } = reservedBy(
        agents.filter((a) => a.id !== agent.id),
      );
      const totalCpu = cpuMilli + newCpu;
      const totalMemory = memoryBytes + newMemory;
      const ceilCpu = parseCpuMilli(ceiling.cpu);
      const ceilMemory = parseMemoryBytes(ceiling.memory);
      if (totalCpu > ceilCpu || totalMemory > ceilMemory) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            `This size would take your running agents to ${cores(totalCpu)}/${cores(ceilCpu)} ` +
            `and ${gi(totalMemory)}/${gi(ceilMemory)} memory — put another agent to sleep or shrink it first.`,
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
      const ceiling = { ...deps.defaultCeiling, ...override };
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

export interface StorageGate {
  assertCanCreateVm(): Promise<void>;
}

export function createStorageGate(
  deps: Pick<BudgetsServiceDeps, "readVmUsage">,
): StorageGate {
  return {
    async assertCanCreateVm() {
      const refusal = storageRefusal(await deps.readVmUsage());
      if (refusal) throw refusal;
    },
  };
}

export function createBudgetsService(deps: BudgetsServiceDeps): BudgetsService {
  return {
    async reserved(): Promise<BudgetReserved> {
      const [agents, override, vmUsage] = await Promise.all([
        deps.listAgents(),
        deps.readCeilingOverride(),
        deps.readVmUsage(),
      ]);
      const slackUnlinked = vmUsage
        ? await deps.isSlackUnlinked().catch((error: unknown) => {
            getLogger().warn({ error }, "budgets.slack-link.failed");
            return false;
          })
        : false;
      const { cpuMilli, memoryBytes } = reservedBy(agents);
      const ceiling = { ...deps.defaultCeiling, ...override };
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
        ...(vmUsage
          ? {
              vm: {
                ...vmUsageView(
                  vmUsage,
                  new Set(
                    agents
                      .filter((a) => a.spec.backend?.type === "vm")
                      .map((a) => a.id),
                  ),
                ),
                ...(slackUnlinked ? { slackUnlinked } : {}),
              },
            }
          : {}),
      };
    },
  };
}

function reservedBy(agents: readonly BudgetedAgent[]): {
  cpuMilli: number;
  memoryBytes: number;
} {
  let cpuMilli = 0;
  let memoryBytes = 0;
  for (const a of agents) {
    if (a.hibernated || a.overBudget || a.spec.backend?.type === "vm") continue;
    cpuMilli += parseCpuMilli(a.spec.resources?.limits?.cpu);
    memoryBytes += parseMemoryBytes(a.spec.resources?.limits?.memory);
  }
  return { cpuMilli, memoryBytes };
}

const cores = (n: number) => `${(n / 1000).toFixed(1)} CPU`;
const gi = (n: number) => `${(n / 1024 ** 3).toFixed(1)}Gi`;
