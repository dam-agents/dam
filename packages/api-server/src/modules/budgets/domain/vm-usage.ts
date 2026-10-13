import { TRPCError } from "@trpc/server";
import type { BudgetVmUsage } from "api-server-api";

export interface RunnerUsage {
  storage: { usedBytes: number; usableBytes: number };
  memory: { limitMiB: number; committedMiB: number };
  machines: { id: string; state: string; usedMiB: number; diskGiB: number }[];
  observedAt: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the same threshold the runner refuses a new disk at, so the api-server's refusal is the runner's, said before an Agent is written rather than after its machine is refused.
export const STORAGE_FULL_PERCENT = 90;

const MIB = 1024 ** 2;

// UNIT_BOUNDARY_DESCRIPTION: the runner's figures as the budgets read publishes them, in bytes, with only the caller's own agents listed: a runner outside the cluster serves every owner and lists every machine.
export function vmUsageView(
  usage: RunnerUsage,
  ownAgentIds: ReadonlySet<string>,
): BudgetVmUsage {
  return {
    memory: {
      usedBytes: usage.memory.committedMiB * MIB,
      limitBytes: usage.memory.limitMiB * MIB,
    },
    storage: {
      usedBytes: usage.storage.usedBytes,
      usableBytes: usage.storage.usableBytes,
    },
    agents: usage.machines
      .filter((m) => ownAgentIds.has(m.id))
      .map((m) => ({ id: m.id, memoryUsedBytes: m.usedMiB * MIB })),
    observedAt: usage.observedAt,
  };
}

export function storagePercent(usage: RunnerUsage): number | null {
  const { usedBytes, usableBytes } = usage.storage;
  return usableBytes > 0 ? Math.floor((usedBytes * 100) / usableBytes) : null;
}

// UNIT_BOUNDARY_DESCRIPTION: the refusal of a new vm agent once the owner's storage is STORAGE_FULL_PERCENT used: the figures, why nothing waits, and the three ways out. Unknown or unmeasured usage refuses nothing.
export function storageRefusal(usage: RunnerUsage | null): TRPCError | null {
  if (!usage) return null;
  const percent = storagePercent(usage);
  if (percent === null || percent < STORAGE_FULL_PERCENT) return null;
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
