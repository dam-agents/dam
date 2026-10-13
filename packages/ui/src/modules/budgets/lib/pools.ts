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

// UNIT_BOUNDARY_DESCRIPTION: one pool as a bar: each agent's share largest first, the shares too thin to see folded into one "N more" segment, and what the pool counts beyond the agents' own shares as one last segment named `rest`.
function poolBar(
  shares: readonly { agent: AgentView; bytes: number }[],
  usedBytes: number,
  limitBytes: number,
  level: PoolLevel,
  rest: string,
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
  const restBytes =
    usedBytes - shown.reduce((sum, s) => sum + s.bytes, 0) - foldedBytes;
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
    "Headroom for your agents",
  );
}

export function storageBar(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
): PoolBarView {
  return poolBar(
    vmShares(usage, agents, "storageUsedBytes", () => true),
    usage.storage.usedBytes,
    usage.storage.usableBytes,
    usage.storage.level,
    "Caches and system",
  );
}

export function cpuBar(cpu: NonNullable<BudgetVmUsage["cpu"]>): PoolBarView {
  return {
    level: cpu.level,
    segments: [
      {
        agentId: null,
        label: cpu.congestion,
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
