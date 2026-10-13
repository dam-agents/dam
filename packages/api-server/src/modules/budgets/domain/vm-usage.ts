import { TRPCError } from "@trpc/server";
import type { BudgetVmUsage, PoolLevel } from "api-server-api";

export type { PoolLevel };

export interface RunnerUsage {
  storage: { usedBytes: number; usableBytes: number };
  memory: { limitMiB: number; committedMiB: number };
  cpu?: {
    limitMilli: number;
    usedMilli: number;
    throttledPercent: number;
    pressurePercent?: number;
  };
  machines: {
    id: string;
    state: string;
    usedMiB: number;
    diskGiB: number;
    diskUsedBytes: number;
    cpuMilli: number;
  }[];
  observedAt: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the same threshold the runner refuses a new disk at and the controller starts reclaiming memory at, so the api-server's refusal is the runner's, said before an Agent is written rather than after its machine is refused.
export const STORAGE_FULL_PERCENT = 90;
export const POOL_WARNING_PERCENT = 75;

// UNIT_BOUNDARY_DESCRIPTION: the one definition of how full a pool is. The create refusal, the resource alerts and the usage the web app shows all read their thresholds here, so they cannot disagree about when a pool is critical.
export function poolLevel(percent: number): PoolLevel {
  if (percent >= STORAGE_FULL_PERCENT) return "critical";
  if (percent >= POOL_WARNING_PERCENT) return "warning";
  return "ok";
}

// UNIT_BOUNDARY_DESCRIPTION: CPU pressure — the share of the last minute the agents waited for a CPU — is never refused on, since a CPU that is short only slows agents down, so its levels sit lower than the other pools': warning from CPU_WARNING_PERCENT, critical (shown as slowed down) from CPU_CRITICAL_PERCENT. A runner too old to report pressure is judged by its throttling.
export const CPU_WARNING_PERCENT = 20;
export const CPU_CRITICAL_PERCENT = 50;

export function cpuLevel(pressurePercent: number): PoolLevel {
  if (pressurePercent < CPU_WARNING_PERCENT) return "ok";
  return pressurePercent < CPU_CRITICAL_PERCENT ? "warning" : "critical";
}

const levelOf = (used: number, limit: number): PoolLevel =>
  limit > 0 ? poolLevel(Math.floor((used * 100) / limit)) : "ok";

const MIB = 1024 ** 2;

// UNIT_BOUNDARY_DESCRIPTION: the runner's figures as the budgets read publishes them, in bytes, with only the caller's own agents listed: a runner outside the cluster serves every owner and lists every machine.
export function vmUsageView(
  usage: RunnerUsage,
  ownAgentIds: ReadonlySet<string>,
): BudgetVmUsage {
  const usedBytes = usage.memory.committedMiB * MIB;
  const limitBytes = usage.memory.limitMiB * MIB;
  const { storage, cpu } = usage;
  return {
    memory: { usedBytes, limitBytes, level: levelOf(usedBytes, limitBytes) },
    storage: {
      usedBytes: storage.usedBytes,
      usableBytes: storage.usableBytes,
      level: levelOf(storage.usedBytes, storage.usableBytes),
    },
    ...(cpu && (cpu.limitMilli > 0 || cpu.pressurePercent !== undefined)
      ? { cpu: cpuView(cpu) }
      : {}),
    agents: usage.machines
      .filter((m) => ownAgentIds.has(m.id))
      .map((m) => ({
        id: m.id,
        memoryUsedBytes: m.usedMiB * MIB,
        storageUsedBytes: m.diskUsedBytes,
        cpuMilli: m.cpuMilli,
      })),
    observedAt: usage.observedAt,
  };
}

function cpuView(
  cpu: NonNullable<RunnerUsage["cpu"]>,
): NonNullable<BudgetVmUsage["cpu"]> {
  const pressurePercent = cpu.pressurePercent ?? cpu.throttledPercent;
  const level = cpuLevel(pressurePercent);
  return {
    limitMilli: cpu.limitMilli,
    usedMilli: cpu.usedMilli,
    throttledPercent: cpu.throttledPercent,
    pressurePercent,
    level,
    slowed: level !== "ok",
  };
}

export function storagePercent(usage: RunnerUsage): number | null {
  const { usedBytes, usableBytes } = usage.storage;
  return usableBytes > 0 ? Math.floor((usedBytes * 100) / usableBytes) : null;
}

// UNIT_BOUNDARY_DESCRIPTION: the refusal of a new vm agent once the owner's storage is at the critical level: the figures, why nothing waits, and the three ways out. Unknown or unmeasured usage refuses nothing.
export function storageRefusal(usage: RunnerUsage | null): TRPCError | null {
  if (!usage) return null;
  const percent = storagePercent(usage);
  if (percent === null || poolLevel(percent) !== "critical") return null;
  const { usedBytes, usableBytes } = usage.storage;
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      `Your agents' shared storage is ${percent}% full (${gib(usedBytes)} of ${gib(usableBytes)}), ` +
      "so a new agent can't be created. Delete an agent you no longer need, clear caches inside your agents, " +
      "or ask an admin for more storage.",
    cause: { storageFull: { usedBytes, usableBytes, percent } },
  });
}

const gib = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GiB`;
