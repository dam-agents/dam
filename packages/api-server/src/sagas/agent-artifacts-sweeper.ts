/**
 * Periodic orphan reaper for per-agent Postgres state.
 *
 * The agent identity lives in K8s Agent custom resources; rules and
 * approvals live in Postgres keyed by `agent_id`. There's no cross-store
 * foreign key, and `agents.delete` runs the cleanup hooks best-effort.
 * Anything those hooks miss (replica died mid-delete, hook threw, manual
 * `kubectl delete agent`, pre-cleanup-hook agent on upgrade) accumulates as
 * orphan rows.
 *
 * Strategy: every `intervalMs` list the live Agent CRs and the distinct
 * `agent_id`s referenced in each Postgres table; the difference is the orphan
 * set; delete those rows.
 *
 * This is only the tick — scheduling lives on the platform periodic-jobs
 * queue (one execution per period across replicas). The tick stays safe
 * under at-least-once execution: the diff queries are read-only and the
 * deletes are idempotent, so an overlapping run is order-independent.
 */
import type { K8sClient } from "../modules/agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../modules/agents/infrastructure/labels.js";

export interface AgentArtifactsSweeper {
  /** Run one scan. */
  tick(): Promise<void>;
}

export interface CreateAgentArtifactsSweeperDeps {
  k8s: K8sClient;
  /** One per Postgres table that holds per-agent state. The sweeper unions
   *  their distinct-agent-ids and feeds orphans back to each `cleanup`. */
  sources: ReadonlyArray<{
    name: string;
    listAgentIds: () => Promise<string[]>;
    cleanup: (agentId: string) => Promise<void>;
  }>;
  /** Cap orphans deleted per tick. Bounds work on a cluster with a large
   *  burst of deletes. Remaining orphans get the next tick. */
  batchSize: number;
}

export function createAgentArtifactsSweeper(
  deps: CreateAgentArtifactsSweeperDeps,
): AgentArtifactsSweeper {
  async function tick(): Promise<void> {
    const agents = await deps.k8s.listCustomObjects(AGENTS_PLURAL);
    const live = new Set(
      agents
        .map((a) => a.metadata?.name)
        .filter((n): n is string => Boolean(n)),
    );

    const orphans = new Set<string>();
    for (const source of deps.sources) {
      const ids = await source.listAgentIds();
      for (const id of ids) {
        if (!live.has(id)) orphans.add(id);
      }
    }

    if (orphans.size === 0) return;

    const toDelete = [...orphans].slice(0, deps.batchSize);
    for (const agentId of toDelete) {
      for (const source of deps.sources) {
        try {
          await source.cleanup(agentId);
        } catch (err) {
          process.stderr.write(
            `[agent-artifacts-sweeper] ${source.name} cleanup failed for ${agentId}: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
    }
    process.stderr.write(
      `[agent-artifacts-sweeper] reaped ${toDelete.length} orphan(s) (${orphans.size} known)\n`,
    );
  }

  return { tick };
}
