import { TRPCError } from "@trpc/server";
import type { BudgetVmUsage, PoolLevel } from "api-server-api";

export interface RunnerUsage {
  storage: { usedBytes: number; usableBytes: number };
  memory: { limitMiB: number; committedMiB: number };
  cpu?: { limitMilli: number; usedMilli: number; throttledPercent: number };
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

// UNIT_BOUNDARY_DESCRIPTION: the levels every pool is shown and acted on at, defined once so the home dashboard, the create refusal and the Slack alerts agree. Critical is the same threshold the runner refuses a new disk at and the controller starts reclaiming memory at, so the api-server's refusal is the runner's, said before an Agent is written rather than after its machine is refused.
export const POOL_WARNING_PERCENT = 75;
export const POOL_CRITICAL_PERCENT = 90;

// UNIT_BOUNDARY_DESCRIPTION: the share of its active scheduler periods in which the runner's CPU limit held it back, from which its agents count as slowed down. CPU never fails anything, so it has no critical level.
export const CPU_SLOWED_PERCENT = 20;

export function poolPercent(used: number, limit: number): number | null {
  return limit > 0 ? Math.floor((used * 100) / limit) : null;
}

export function poolLevel(used: number, limit: number): PoolLevel {
  const percent = poolPercent(used, limit);
  if (percent === null || percent < POOL_WARNING_PERCENT) return "ok";
  return percent < POOL_CRITICAL_PERCENT ? "warning" : "critical";
}

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
    memory: { usedBytes, limitBytes, level: poolLevel(usedBytes, limitBytes) },
    storage: {
      usedBytes: storage.usedBytes,
      usableBytes: storage.usableBytes,
      level: poolLevel(storage.usedBytes, storage.usableBytes),
    },
    ...(cpu && cpu.limitMilli > 0
      ? {
          cpu: {
            ...cpu,
            slowed: cpu.throttledPercent >= CPU_SLOWED_PERCENT,
          },
        }
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

// UNIT_BOUNDARY_DESCRIPTION: the refusal of a new vm agent once the owner's storage is at the critical level: the figures, why nothing waits, and the three ways out. Unknown or unmeasured usage refuses nothing.
export function storageRefusal(usage: RunnerUsage | null): TRPCError | null {
  if (!usage) return null;
  const { usedBytes, usableBytes } = usage.storage;
  const percent = poolPercent(usedBytes, usableBytes);
  if (percent === null || poolLevel(usedBytes, usableBytes) !== "critical")
    return null;
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
