import type { ExperimentDriverSummary, ExperimentStatus } from "api-server-api";

import type { AgentView } from "../../../types.js";

export interface LineageRow {
  key: string;
  driverAgentId: string;
  name: string;
  runCount: number;
  liveCount: number;
  badge: ExperimentStatus;
  runningInvocations: number;
  newestAt: string;
  experimentIds: string[];
}

export interface SandboxGroup {
  agentId: string;
  agent: AgentView | null;
  name: string;
  lineages: LineageRow[];
  rollup: ExperimentStatus | null;
}

function rollupStatus(lineages: LineageRow[]): ExperimentStatus | null {
  if (lineages.length === 0) return null;
  return lineages[0]?.badge ?? null;
}

function toLineages(summary: ExperimentDriverSummary): LineageRow[] {
  const byName = new Map<string, ExperimentDriverSummary["experiments"]>();
  for (const experiment of summary.experiments) {
    byName.set(experiment.name, [
      ...(byName.get(experiment.name) ?? []),
      experiment,
    ]);
  }
  const rows: LineageRow[] = [];
  for (const [name, experiments] of byName) {
    const runs = experiments.filter((e) => e.status !== "draft");
    const live = runs.filter((e) => e.status === "running");
    rows.push({
      key: `${summary.driverAgentId}\n${name}`,
      driverAgentId: summary.driverAgentId,
      name,
      runCount: runs.length,
      liveCount: live.length,
      badge: live[0]?.status ?? runs[0]?.status ?? "draft",
      runningInvocations: live.length > 0 ? summary.runningInvocations : 0,
      newestAt: experiments[0]?.createdAt ?? "",
      experimentIds: experiments.map((e) => e.id),
    });
  }
  return rows.sort((a, b) => {
    if (a.liveCount > 0 !== b.liveCount > 0) return a.liveCount > 0 ? -1 : 1;
    return b.newestAt.localeCompare(a.newestAt);
  });
}

export function toSandboxGroups(
  summaries: ExperimentDriverSummary[],
  agents: AgentView[],
  isMarked: (agent: AgentView) => boolean,
): SandboxGroup[] {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const groups = new Map<string, SandboxGroup>();

  const deletedLineages: LineageRow[] = [];
  for (const summary of summaries) {
    const agent = agentById.get(summary.driverAgentId) ?? null;
    const lineages = toLineages(summary);
    if (agent === null) {
      deletedLineages.push(...lineages);
      continue;
    }
    groups.set(summary.driverAgentId, {
      agentId: summary.driverAgentId,
      agent,
      name: agent.name,
      lineages,
      rollup: rollupStatus(lineages),
    });
  }
  if (deletedLineages.length > 0) {
    deletedLineages.sort((a, b) => b.newestAt.localeCompare(a.newestAt));
    groups.set("__deleted__", {
      agentId: "__deleted__",
      agent: null,
      name: "Deleted agents",
      lineages: deletedLineages,
      rollup: null,
    });
  }

  for (const agent of agents) {
    if (!isMarked(agent) || groups.has(agent.id)) continue;
    groups.set(agent.id, {
      agentId: agent.id,
      agent,
      name: agent.name,
      lineages: [],
      rollup: null,
    });
  }

  const rank = (group: SandboxGroup) => {
    if (group.agent === null) return 3;
    if (group.lineages.some((l) => l.liveCount > 0)) return 0;
    if (group.lineages.length > 0) return 1;
    return 2;
  };
  return [...groups.values()].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const aNewest = a.lineages[0]?.newestAt ?? "";
    const bNewest = b.lineages[0]?.newestAt ?? "";
    if (aNewest !== bNewest) return bNewest.localeCompare(aNewest);
    return a.name.localeCompare(b.name);
  });
}
