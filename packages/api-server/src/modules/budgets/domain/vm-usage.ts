import { TRPCError } from "@trpc/server";
import type { BudgetVmUsage, CpuCongestion, PoolLevel } from "api-server-api";

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
// UNIT_BOUNDARY_DESCRIPTION: the runner's own limits past STORAGE_FULL_PERCENT: from the first it starts no machine, and from the second a guest's writes are failing.
export const STORAGE_START_LIMIT_PERCENT = 97;
export const STORAGE_WRITES_FAILING_PERCENT = 98;

// UNIT_BOUNDARY_DESCRIPTION: the one definition of how full a pool is. The create refusal, the resource alerts and the usage the web app shows all read their thresholds here, so they cannot disagree about when a pool is critical.
export function poolLevel(percent: number): PoolLevel {
  if (percent >= STORAGE_FULL_PERCENT) return "critical";
  if (percent >= POOL_WARNING_PERCENT) return "warning";
  return "ok";
}

const CONGESTION: [CpuCongestion, number, PoolLevel][] = [
  ["severe", 75, "critical"],
  ["high", 50, "critical"],
  ["moderate", 20, "warning"],
];

// UNIT_BOUNDARY_DESCRIPTION: CPU pressure p (the share of the last minute the agents waited for a CPU) slows them by 1/(1−p), so the bar is log-scaled slowdown: full at 4× slower (p = 75%, "severe"). CPU is never refused on, so its levels sit lower than the other pools'. A runner too old to report pressure is judged by its throttling.
export function cpuLevel(pressurePercent: number): {
  congestion: CpuCongestion;
  level: PoolLevel;
  fill: number;
} {
  const p = Math.min(Math.max(pressurePercent, 0), 100) / 100;
  const fill = p >= 0.75 ? 1 : Math.log(1 / (1 - p)) / Math.log(4);
  const [congestion, , level] = CONGESTION.find(
    ([, from]) => pressurePercent >= from,
  ) ?? ["low", 0, "ok"];
  return { congestion, level, fill };
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
  return {
    limitMilli: cpu.limitMilli,
    usedMilli: cpu.usedMilli,
    throttledPercent: cpu.throttledPercent,
    pressurePercent,
    ...cpuLevel(pressurePercent),
  };
}

export function storagePercent(usage: RunnerUsage): number | null {
  const { usedBytes, usableBytes } = usage.storage;
  return usableBytes > 0 ? Math.floor((usedBytes * 100) / usableBytes) : null;
}

// UNIT_BOUNDARY_DESCRIPTION: the one storage-full message, said the same way by the create refusal, the Slack alert and a refused wake, and matching the runner's own refusal: what is refused at the current level, that a stopped VM agent can still be opened to clean up until storage is nearly full, and the ways to free space. Without figures, as on a refused wake, it says only that starts stop once storage is nearly full, which holds whatever the level.
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
    percent === null
      ? "Once storage is nearly full, stopped VM agents can't be started until space is freed."
      : percent >= STORAGE_START_LIMIT_PERCENT
        ? "Stopped VM agents can't be started until space is freed."
        : "Stopped VM agents can still be started until storage is nearly full, so you can open one and ask it to clear its caches.",
    "To free space, delete a VM agent you no longer need, open an agent and ask it to clear its caches, or request more storage.",
  ]
    .filter(Boolean)
    .join(" ");
}

// UNIT_BOUNDARY_DESCRIPTION: the refusal of a new vm agent once the owner's storage is at the critical level. Unknown or unmeasured usage refuses nothing.
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
