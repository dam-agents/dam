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
export const POOL_WARNING_PERCENT = 75;
// UNIT_BOUNDARY_DESCRIPTION: the runner's own limits past STORAGE_FULL_PERCENT: from the first it starts no machine, and from the second a guest's writes are failing.
export const STORAGE_START_LIMIT_PERCENT = 97;
export const STORAGE_WRITES_FAILING_PERCENT = 98;

export type PoolLevel = "ok" | "warning" | "critical";

// UNIT_BOUNDARY_DESCRIPTION: the one definition of how full a pool is. The create refusal, the resource alerts and the usage the web app shows all read their thresholds here, so they cannot disagree about when a pool is critical.
export function poolLevel(percent: number): PoolLevel {
  if (percent >= STORAGE_FULL_PERCENT) return "critical";
  if (percent >= POOL_WARNING_PERCENT) return "warning";
  return "ok";
}

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

// UNIT_BOUNDARY_DESCRIPTION: the one storage-full message, said the same way by the create refusal, the Slack alert and a refused wake, and matching the runner's own refusal: what is refused at the current level, that a stopped VM agent can still be opened to clean up until storage is nearly full, and the ways to free space. Without figures it speaks of storage that is full.
export function storageFullMessage(figures?: {
  usedBytes: number;
  usableBytes: number;
}): string {
  const percent =
    figures && figures.usableBytes > 0
      ? Math.floor((figures.usedBytes * 100) / figures.usableBytes)
      : null;
  const used = figures
    ? `Your VM agents have used ${gib(figures.usedBytes)} of ${gib(figures.usableBytes)} GiB of their shared storage`
    : "Your VM agents' shared storage is full";
  return [
    percent !== null && percent >= STORAGE_WRITES_FAILING_PERCENT
      ? "Your running VM agents may be failing to write files now."
      : null,
    `${used}, so new VM agents can't be created and their disks can't grow.`,
    percent !== null && percent >= STORAGE_START_LIMIT_PERCENT
      ? "Stopped VM agents can't be started until space is freed."
      : "Stopped VM agents can still be started until storage is nearly full, so you can open one and ask it to clear its caches.",
    "To free space, delete a VM agent you no longer need, open an agent and ask it to clear its caches, or request more storage.",
  ]
    .filter(Boolean)
    .join(" ");
}

// UNIT_BOUNDARY_DESCRIPTION: the refusal of a new vm agent once the owner's storage is STORAGE_FULL_PERCENT used. Unknown or unmeasured usage refuses nothing.
export function storageRefusal(usage: RunnerUsage | null): TRPCError | null {
  if (!usage) return null;
  const percent = storagePercent(usage);
  if (percent === null || poolLevel(percent) !== "critical") return null;
  const { usedBytes, usableBytes } = usage.storage;
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: storageFullMessage(usage.storage),
    cause: { storageFull: { usedBytes, usableBytes, percent } },
  });
}

const gib = (n: number) => (n / 1024 ** 3).toFixed(1);
