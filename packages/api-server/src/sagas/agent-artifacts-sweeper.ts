/**
 * Periodic orphan reaper for per-agent Postgres state.
 *
 * The agent identity lives in K8s ConfigMaps; rules and approvals live in
 * Postgres keyed by `agent_id`. There's no cross-store foreign key, and
 * `agents.delete` runs the cleanup hooks best-effort. Anything those hooks
 * miss (replica died mid-delete, hook threw, manual `kubectl delete cm`,
 * pre-cleanup-hook agent on upgrade) accumulates as orphan rows.
 *
 * Strategy: every `intervalMs` list the live agent ConfigMaps and the
 * distinct `agent_id`s referenced in each Postgres table; the difference
 * is the orphan set; delete those rows.
 *
 * Multi-replica: every replica runs this; the diff queries are read-only
 * and the deletes are idempotent. A randomized initial delay keeps replicas
 * from all firing the same scan in lockstep on startup, but a small overlap
 * is fine — `DELETE WHERE agent_id IN (...)` is order-independent.
 */
import type { K8sClient } from "../modules/agents/infrastructure/k8s.js";
import {
  LABEL_TYPE,
  TYPE_AGENT,
} from "../modules/agents/infrastructure/labels.js";

export interface AgentArtifactsSweeper {
  start(): void;
  stop(): Promise<void>;
  /** Run one scan synchronously. Exposed for tests and any future
   *  operator-triggered "sweep now" path; the regular `start()` schedules
   *  this on a timer with a randomized initial delay. */
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
  intervalMs: number;
  /** Cap orphans deleted per tick. Bounds work on a cluster with a large
   *  burst of deletes. Remaining orphans get the next tick. */
  batchSize: number;
}

export function createAgentArtifactsSweeper(
  deps: CreateAgentArtifactsSweeperDeps,
): AgentArtifactsSweeper {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const cms = await deps.k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_AGENT}`);
      const live = new Set(
        cms
          .map((cm) => cm.metadata?.name)
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
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      // Initial delay 0..intervalMs so multi-replica starts don't stack.
      const jitter = Math.floor(Math.random() * deps.intervalMs);
      timer = setTimeout(() => {
        tick().catch(() => {});
        timer = setInterval(() => {
          tick().catch(() => {});
        }, deps.intervalMs);
        timer.unref?.();
      }, jitter);
      timer.unref?.();
    },
    async stop() {
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
        timer = null;
      }
      while (running) await new Promise((r) => setTimeout(r, 50));
    },
  };
}
