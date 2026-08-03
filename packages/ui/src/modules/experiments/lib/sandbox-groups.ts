import type { ExperimentDriverSummary, ExperimentStatus } from "api-server-api";

import type { AgentView } from "../../../types.js";

/** One named loop within a sandbox, rolled up from its draft and runs. The
 *  experiment is the unit the user thinks in; the sandbox is where it lives. */
export interface LineageRow {
  key: string;
  driverAgentId: string;
  name: string;
  runCount: number;
  liveCount: number;
  /** Live wins, else the newest run's status, else draft. */
  badge: ExperimentStatus;
  /** Driver-level running-invocation count, shown on live lineages. */
  runningInvocations: number;
  /** createdAt of the lineage's newest row — the recency sort key. */
  newestAt: string;
  /** Every experiment row in the lineage (draft + runs) — the delete set. */
  experimentIds: string[];
}

/** A sandbox and the experiments it holds — the container, since one sandbox can
 *  hold many. */
export interface SandboxGroup {
  agentId: string;
  /** Null when the sandbox was deleted — its results outlive it. */
  agent: AgentView | null;
  name: string;
  lineages: LineageRow[];
  /** The experiments' rolled-up status, not the agent's lifecycle: live wins,
   *  else the newest lineage's own badge. Null when there are none yet. */
  rollup: ExperimentStatus | null;
}

function rollupStatus(lineages: LineageRow[]): ExperimentStatus | null {
  if (lineages.length === 0) return null;
  // toLineages already sorted live-first, then newest-first, so the head is the
  // one worth reporting.
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
    // Summary order is newest-first already.
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

/** Marked experiment sandboxes ∪ agents that registered a plan. Both belong: the
 *  Kind marker is intent, and Plan Registration is keyed only on the calling
 *  agent, so any sandbox can become a driver. A deleted sandbox keeps its group
 *  so its results stay reachable.
 *
 *  Order: live, then by recency, then empty, then deleted. */
export function toSandboxGroups(
  summaries: ExperimentDriverSummary[],
  agents: AgentView[],
  isMarked: (agent: AgentView) => boolean,
): SandboxGroup[] {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const groups = new Map<string, SandboxGroup>();

  // Every deleted sandbox's lineages collect into ONE trailing group, as the
  // vision draws it — the sandboxes are gone, so per-sandbox containers would
  // just multiply tombstones.
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
      name: "Deleted sandboxes",
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
