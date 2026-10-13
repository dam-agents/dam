import type { BudgetVmUsage, PoolLevel } from "api-server-api";

import type { AgentView } from "../../../types.js";

export interface PoolSegment {
  agentId: string | null;
  label: string;
  bytes: number;
}

export interface PoolBarView {
  percent: number;
  level: PoolLevel;
  usedBytes: number;
  limitBytes: number;
  segments: PoolSegment[];
}

const MIN_SEGMENT_PERCENT = 2;

// UNIT_BOUNDARY_DESCRIPTION: one pool as a bar: each agent's share largest first, the shares too thin to see folded into one "N more" segment, and what the pool counts beyond the agents' own shares as one last segment named `rest`.
function poolBar(
  shares: readonly { agent: AgentView; bytes: number }[],
  usedBytes: number,
  limitBytes: number,
  level: PoolLevel,
  rest: string,
): PoolBarView {
  const sorted = shares
    .filter((s) => s.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const visible = (bytes: number) =>
    limitBytes > 0 && (bytes * 100) / limitBytes >= MIN_SEGMENT_PERCENT;
  const shown = sorted.filter((s) => visible(s.bytes));
  const folded = sorted.filter((s) => !visible(s.bytes));
  const segments: PoolSegment[] = shown.map((s) => ({
    agentId: s.agent.id,
    label: s.agent.name,
    bytes: s.bytes,
  }));
  const foldedBytes = folded.reduce((sum, s) => sum + s.bytes, 0);
  if (folded.length > 0)
    segments.push({
      agentId: null,
      label: `${folded.length} more`,
      bytes: foldedBytes,
    });
  const restBytes =
    usedBytes - segments.reduce((sum, segment) => sum + segment.bytes, 0);
  if (restBytes > 0)
    segments.push({ agentId: null, label: rest, bytes: restBytes });
  return {
    percent:
      limitBytes > 0
        ? Math.min(100, Math.floor((usedBytes * 100) / limitBytes))
        : 0,
    level,
    usedBytes,
    limitBytes,
    segments,
  };
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

export function topCpuAgents(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
  limit = 3,
): { agent: AgentView; cpuMilli: number }[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return usage.agents
    .flatMap((share) => {
      const agent = byId.get(share.id);
      return agent && share.cpuMilli > 0
        ? [{ agent, cpuMilli: share.cpuMilli }]
        : [];
    })
    .sort((a, b) => b.cpuMilli - a.cpuMilli)
    .slice(0, limit);
}

export function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
}

export interface AgentShare {
  agent: AgentView;
  bytes: number;
}

export function idleVmAgents(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
  busyIds: ReadonlySet<string>,
): AgentShare[] {
  return vmShares(
    usage,
    agents,
    "memoryUsedBytes",
    (a) => a.state === "running" && !a.stopRequested && !busyIds.has(a.id),
  ).sort((a, b) => b.bytes - a.bytes);
}

export function largestVmAgents(
  usage: BudgetVmUsage,
  agents: readonly AgentView[],
  limit = 3,
): AgentShare[] {
  return vmShares(usage, agents, "storageUsedBytes", (a) => !a.stopRequested)
    .filter((s) => s.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}
