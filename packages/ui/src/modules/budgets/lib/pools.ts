import type { BudgetVmUsage, PoolLevel } from "api-server-api";

import type { AgentView } from "../../../types.js";

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

// UNIT_BOUNDARY_DESCRIPTION: one pool as a bar: each agent's share largest first, the shares too thin to see folded into one "N more" segment, the named `parts` the pool holds beside the agents' shares, and what it counts beyond all of them as one last segment named `rest`.
function poolBar(
  shares: readonly { agent: AgentView; bytes: number }[],
  usedBytes: number,
  limitBytes: number,
  level: PoolLevel,
  rest: string,
  parts: readonly PoolPart[] = [],
): PoolBarView {
  const of = (bytes: number) => (limitBytes > 0 ? bytes / limitBytes : 0);
  const sorted = shares
    .filter((s) => s.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const shown = sorted.filter((s) => of(s.bytes) >= MIN_SEGMENT_FRACTION);
  const folded = sorted.filter((s) => of(s.bytes) < MIN_SEGMENT_FRACTION);
  const segments: PoolSegment[] = shown.map((s) => ({
    agentId: s.agent.id,
    label: `${s.agent.name} · ${formatBytes(s.bytes)}`,
    fraction: of(s.bytes),
    filled: true,
  }));
  const foldedBytes = folded.reduce((sum, s) => sum + s.bytes, 0);
  if (folded.length > 0)
    segments.push({
      agentId: null,
      label: `${folded.length} more · ${formatBytes(foldedBytes)}`,
      fraction: of(foldedBytes),
      filled: false,
    });
  const named = parts.filter((part) => part.bytes > 0);
  for (const part of named)
    segments.push({
      agentId: null,
      label: `${part.label} · ${formatBytes(part.bytes)}`,
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
      label: `${rest} · ${formatBytes(restBytes)}`,
      fraction: of(restBytes),
      filled: false,
    });
  return { level, segments };
}

function vmShares<K extends "memoryUsedBytes" | "storageUsedBytes">(
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
  seeds: "Agents moving to VMs",
  rest: "Logs and system",
} as const;

const storageParts = (usage: BudgetVmUsage): PoolPart[] => [
  { label: STORAGE_PARTS.seeds, bytes: usage.storage.seedBytes },
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

// UNIT_BOUNDARY_DESCRIPTION: what fills the owner's shared storage, largest first: each agent's disk, the copies of homes that runtime migrations still hold, and the runner's own logs and records as what is left. A part that takes nothing is left out.
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
    .filter((row) => row.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

export function cpuBar(cpu: NonNullable<BudgetVmUsage["cpu"]>): PoolBarView {
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

export function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
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
