import type { BudgetVmUsage, PoolLevel } from "api-server-api";

import { formatBytes } from "../../../lib/format-size.js";
import type { AgentView } from "../../../types.js";
import { formatCores } from "./format.js";

export interface PoolSegment {
  agentId: string | null;
  label: string;
  fraction: number;
  filled: boolean;
}

export interface PoolBarView {
  level: PoolLevel;
  segments: PoolSegment[];
}

const MIN_SEGMENT_FRACTION = 0.02;

export interface PoolPart {
  label: string;
  bytes: number;
}

// UNIT_BOUNDARY_DESCRIPTION: one pool as a bar: each agent's share largest first, the shares too thin to see folded into one "N more" segment, the named `parts` the pool holds beside the agents' shares, and what it counts beyond all of them as one last segment named `rest`. Shares are bytes unless `format` says how to name another unit.
function poolBar(
  shares: readonly { agent: AgentView; bytes: number }[],
  usedBytes: number,
  limitBytes: number,
  level: PoolLevel,
  rest: string,
  parts: readonly PoolPart[] = [],
  format: (amount: number) => string = formatBytes,
): PoolBarView {
  const of = (bytes: number) => (limitBytes > 0 ? bytes / limitBytes : 0);
  const sorted = shares
    .filter((s) => s.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const shown = sorted.filter((s) => of(s.bytes) >= MIN_SEGMENT_FRACTION);
  const folded = sorted.filter((s) => of(s.bytes) < MIN_SEGMENT_FRACTION);
  const segments: PoolSegment[] = shown.map((s) => ({
    agentId: s.agent.id,
    label: `${s.agent.name} · ${format(s.bytes)}`,
    fraction: of(s.bytes),
    filled: true,
  }));
  const foldedBytes = folded.reduce((sum, s) => sum + s.bytes, 0);
  if (folded.length > 0)
    segments.push({
      agentId: null,
      label: `${folded.length} more · ${format(foldedBytes)}`,
      fraction: of(foldedBytes),
      filled: false,
    });
  const named = parts.filter((part) => part.bytes > 0);
  for (const part of named)
    segments.push({
      agentId: null,
      label: `${part.label} · ${format(part.bytes)}`,
      fraction: of(part.bytes),
      filled: false,
    });
  const restBytes =
    usedBytes -
    shown.reduce((sum, s) => sum + s.bytes, 0) -
    foldedBytes -
    named.reduce((sum, part) => sum + part.bytes, 0);
  if (restBytes > 0)
    segments.push({
      agentId: null,
      label: `${rest} · ${format(restBytes)}`,
      fraction: of(restBytes),
      filled: false,
    });
  return { level, segments };
}

function vmShares<
  K extends "memoryUsedBytes" | "storageUsedBytes" | "cpuMilli",
>(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
  key: K,
  include: (agent: AgentView) => boolean,
) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return usage.agents.flatMap((share) => {
    const agent = byId.get(share.id);
    return agent && include(agent) ? [{ agent, bytes: share[key] }] : [];
  });
}

export function memoryBar(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
): PoolBarView {
  return poolBar(
    vmShares(usage, agents, "memoryUsedBytes", (a) => a.state !== "hibernated"),
    usage.memory.usedBytes,
    usage.memory.limitBytes,
    usage.memory.level,
    "Reserved for growth",
  );
}

export const STORAGE_PARTS = {
  retained: "Machine disk copies",
  rest: "Logs and system",
} as const;

const storageParts = (usage: BudgetVmUsage): PoolPart[] => [
  { label: STORAGE_PARTS.retained, bytes: usage.storage.seedBytes },
];

export function storageBar(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
): PoolBarView {
  return poolBar(
    vmShares(usage, agents, "storageUsedBytes", () => true),
    usage.storage.usedBytes,
    usage.storage.usableBytes,
    usage.storage.level,
    STORAGE_PARTS.rest,
    storageParts(usage),
  );
}

export interface StorageRow {
  agent: AgentView | null;
  label: string;
  bytes: number;
  // UNIT_BOUNDARY_DESCRIPTION: the agent's own storage is full, so its writes are failing while it runs: the row says so where the owner goes to free space.
  homeFull: boolean;
}

// UNIT_BOUNDARY_DESCRIPTION: what fills the owner's shared storage, largest first: each agent's disk, the disk copies the runner still holds, and the runner's own logs and records as what is left. A part that takes nothing is left out, but a row whose own storage is full stays even at zero bytes: a disk the runner could not read reports none, and the mark is why the owner is looking.
export function storageRows(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
): StorageRow[] {
  const shares = vmShares(usage, agents, "storageUsedBytes", () => true);
  const parts = storageParts(usage);
  const counted = [...shares, ...parts].reduce((sum, s) => sum + s.bytes, 0);
  const full = new Set(
    usage.agents.filter((share) => share.homeFull).map((share) => share.id),
  );
  return [
    ...shares.map(({ agent, bytes }) => ({
      agent,
      label: agent.name,
      bytes,
      homeFull: full.has(agent.id),
    })),
    ...parts.map((part) => ({ agent: null, homeFull: false, ...part })),
    {
      agent: null,
      homeFull: false,
      label: STORAGE_PARTS.rest,
      bytes: usage.storage.usedBytes - counted,
    },
  ]
    .filter((row) => row.bytes > 0 || row.homeFull)
    .sort((a, b) => b.bytes - a.bytes);
}

export const CPU_REST = "Runner and system";

const cpuOf = (milli: number) => `${formatCores(milli)} CPU`;

// UNIT_BOUNDARY_DESCRIPTION: what the CPU row measures use against: the owner's CPU pool, else the runner's current limit for a server that does not send the pool, else nothing, and then the row falls back to its congestion alone.
export function cpuPoolMilli(cpu: NonNullable<BudgetVmUsage["cpu"]>): number {
  return cpu.poolMilli ?? cpu.limitMilli;
}

// UNIT_BOUNDARY_DESCRIPTION: CPU as a used-of-pool bar like memory's: each running agent's CPU largest first, and what the runner itself and the machines' I/O used as the last segment. The level is still the congestion's, so the colour and the warning sign say when agents wait for a CPU, which a bar short of full does not rule out. With no pool to measure against, the bar is the congestion's fill.
export function cpuBar(
  cpu: NonNullable<BudgetVmUsage["cpu"]>,
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
): PoolBarView {
  const poolMilli = cpuPoolMilli(cpu);
  if (poolMilli <= 0)
    return {
      level: cpu.level,
      segments: [
        {
          agentId: null,
          label: `${cpu.congestion[0].toUpperCase()}${cpu.congestion.slice(1)} congestion`,
          fraction: Math.min(1, Math.max(0, cpu.fill)),
          filled: true,
        },
      ],
    };
  return poolBar(
    vmShares(usage, agents, "cpuMilli", (a) => a.state !== "hibernated"),
    cpu.usedMilli,
    poolMilli,
    cpu.level,
    CPU_REST,
    [],
    cpuOf,
  );
}

const AT_CEILING = 0.9;

// UNIT_BOUNDARY_DESCRIPTION: the agents using nine tenths or more of the vCPUs one machine gets: such an agent is slow because of its own machine's size, which neither the pool nor its congestion shows. Nobody is named when the install does not say how many vCPUs a machine gets.
export function agentsAtCpuCeiling(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
): AgentView[] {
  const machineMilli = usage.cpu?.machineMilli;
  if (!machineMilli) return [];
  return vmShares(usage, agents, "cpuMilli", (a) => a.state !== "hibernated")
    .filter((share) => share.bytes >= machineMilli * AT_CEILING)
    .sort((a, b) => b.bytes - a.bytes)
    .map((share) => share.agent);
}

export function topCpuAgents(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
  limit = 3,
): AgentView[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return usage.agents
    .flatMap((share) => {
      const agent = byId.get(share.id);
      return agent && share.cpuMilli > 0
        ? [{ agent, cpuMilli: share.cpuMilli }]
        : [];
    })
    .sort((a, b) => b.cpuMilli - a.cpuMilli)
    .slice(0, limit)
    .map((t) => t.agent);
}

// UNIT_BOUNDARY_DESCRIPTION: a pool's warning-sign text: the advice at every level, and at critical also what the platform does and, for a user without a Slack link, the command that links it.
export function poolWarning(
  level: PoolLevel,
  advice: string,
  fact: string,
  slackLoginCommand?: string,
): string {
  if (level !== "critical") return advice;
  const invite =
    slackLoginCommand &&
    `Run ${slackLoginCommand} in Slack to get alerts like this there.`;
  return [advice, fact, invite].filter(Boolean).join(" ");
}
