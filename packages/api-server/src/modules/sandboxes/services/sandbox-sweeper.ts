/**
 * Liveness + auto-destroy sweep for sandbox nodes.
 *
 * Three jobs, all the platform's responsibility (the driver never has to):
 *   1. Liveness — a sandbox that ends silently (crash, hibernate, or an agent
 *      that just never calls node_done) would otherwise stay `running` forever
 *      and wedge the driver's poll. Every tick, `running` rows past their
 *      `expiresAt` deadline are failed. This is the handoff's "a step that ends
 *      silently wedges the loop" caveat.
 *   1b. Crash fast-fail — a one-shot node whose pod restarts mid-turn (OOMKill,
 *      eviction) is orphaned: the trigger already fired and is recorded in the
 *      runtime's persisted state, so the prompt is not redelivered and the turn
 *      never resumes. Rather than let it idle to the liveness deadline, any
 *      `running` sandbox whose pod shows a restart is failed immediately.
 *   2. Auto-destroy — a sandbox is an ephemeral Agent; once its row is terminal
 *      (`done`/`failed`) the Agent has served its purpose, so it is deleted
 *      (cascading its pod/gateway/PVC). Deletion is deferred to the sweep rather
 *      than done inside node_done so the tool response flushes before the pod
 *      dies. The row (the durable result record) outlives the Agent and is
 *      dropped only after a retention window, so a driver polling slightly after
 *      the node reports still reads its result rather than a 404.
 *
 * Owner-agnostic: it scans every owner's sandboxes and resolves an owner-scoped
 * agents service per row to delete. Multi-replica safe — `complete`/`fail` are
 * atomic conditional writes and delete is idempotent.
 */

import type { AgentsService } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import type { SandboxesRepository } from "../infrastructure/sandboxes-repository.js";

export interface SandboxSweeper {
  start(): void;
  stop(): Promise<void>;
  /** Run one scan synchronously. Exposed for tests; `start()` schedules it. */
  tick(): Promise<void>;
}

/** How long a terminal sandbox's result row is retained after completion so a
 *  slow poll still reads it. The Agent is reaped well before this. */
const RESULT_RETENTION_MS = 10 * 60 * 1000;

export interface CreateSandboxSweeperDeps {
  repo: SandboxesRepository;
  /** Owner-scoped agents service, for deleting a terminal sandbox's Agent. */
  agentsFor: (owner: string) => AgentsService;
  /** Reads pod restart status to catch a node crashed mid-turn. */
  k8s: Pick<K8sClient, "readPodRestart">;
  intervalMs: number;
  /** Cap rows handled per tick; the rest get the next tick. */
  batchSize: number;
  now?: () => Date;
}

export function createSandboxSweeper(
  deps: CreateSandboxSweeperDeps,
): SandboxSweeper {
  const now = deps.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      // 1. Fail sandboxes that blew their deadline without reporting.
      const expired = await deps.repo.listExpiredRunning(now(), deps.batchSize);
      for (const row of expired) {
        try {
          await deps.repo.fail(row.id, "liveness deadline exceeded");
        } catch (err) {
          process.stderr.write(
            `[sandbox-sweeper] fail ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      // 1b. Fail sandboxes whose pod crashed/restarted mid-turn. The one-shot
      //     trigger already fired (recorded in the runtime's persisted state), so
      //     after a restart the prompt is not redelivered and the turn cannot
      //     resume — it would otherwise idle until its liveness deadline.
      const running = await deps.repo.listRunning(deps.batchSize);
      for (const row of running) {
        try {
          const restart = await deps.k8s.readPodRestart(`${row.id}-0`);
          if (restart && restart.restarts > 0) {
            await deps.repo.fail(
              row.id,
              `sandbox pod restarted${restart.reason ? ` (${restart.reason})` : ""}; one-shot turn cannot resume`,
            );
          }
        } catch (err) {
          process.stderr.write(
            `[sandbox-sweeper] restart-check ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      // 2. Reap the Agent for any terminal sandbox (idempotent — delete is a
      //    no-op once the Agent is gone). Drop the row only after the retention
      //    window so a driver polling just after the node reports still reads
      //    the result rather than a 404.
      const terminal = await deps.repo.listTerminal(deps.batchSize);
      const rowDeadline = new Date(now().getTime() - RESULT_RETENTION_MS);
      let reaped = 0;
      for (const row of terminal) {
        try {
          await deps.agentsFor(row.owner).delete(row.id);
          if (row.completedAt && row.completedAt < rowDeadline) {
            await deps.repo.delete(row.id);
          }
          reaped += 1;
        } catch (err) {
          process.stderr.write(
            `[sandbox-sweeper] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      if (reaped > 0)
        process.stderr.write(
          `[sandbox-sweeper] reaped ${reaped} sandbox(es)\n`,
        );
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
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
