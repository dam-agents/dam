/**
 * Liveness sweep for Invocations (#2816). Bounds one result — it does NOT own
 * the target agent's lifecycle (that is the Agent Sweep, keyed off Agent
 * state). Its jobs, all the platform's responsibility so the driver never has
 * to:
 *   1. Liveness — a target that ends silently (crash, hibernate, or an agent
 *      that just never calls report_result) would otherwise stay `running`
 *      forever and wedge the driver's poll. Every tick, `running` rows past
 *      their `expiresAt` deadline are failed.
 *   1b. Crash fast-fail — a one-shot target whose pod restarts mid-turn
 *      (OOMKill, eviction) is orphaned: the trigger already fired and is
 *      recorded in the runtime's persisted state, so the prompt is not
 *      redelivered and the turn never resumes. Rather than let it idle to the
 *      liveness deadline, any `running` target whose pod shows a restart is
 *      failed immediately.
 *   2. Retention — a terminal Invocation's result row is kept for a short
 *      window so a driver polling just after the target reports still reads its
 *      result rather than a 404, then dropped. The target Agent itself is
 *      reaped elsewhere (eagerly when the Invocation goes terminal, with the
 *      Agent Sweep as backstop), not here.
 *
 * A failed Invocation reaps its target eagerly (a liveness-failed target has no
 * pending tool response to flush, so it can be deleted right away). The target
 * is also Sweepable, so a missed eager delete is caught by the Agent Sweep.
 *
 * Owner-agnostic: it scans every owner's Invocations and resolves an
 * owner-scoped agents service per row to delete. Multi-replica safe — `fail` is
 * an atomic conditional write and delete is idempotent.
 */

import type { AgentsService } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

export interface InvocationLivenessSweep {
  start(): void;
  stop(): Promise<void>;
  /** Run one scan synchronously. Exposed for tests; `start()` schedules it. */
  tick(): Promise<void>;
}

/** How long a terminal Invocation's result row is retained after completion so
 *  a slow poll still reads it. The target Agent is reaped well before this. */
const RESULT_RETENTION_MS = 10 * 60 * 1000;

export interface CreateInvocationLivenessSweepDeps {
  repo: InvocationsRepository;
  /** Owner-scoped agents service, for reaping a liveness-failed target. */
  agentsFor: (owner: string) => AgentsService;
  /** Reads pod restart status to catch a target crashed mid-turn. */
  k8s: Pick<K8sClient, "readAgentPodRestart">;
  intervalMs: number;
  /** Cap rows handled per tick; the rest get the next tick. */
  batchSize: number;
  now?: () => Date;
}

export function createInvocationLivenessSweep(
  deps: CreateInvocationLivenessSweepDeps,
): InvocationLivenessSweep {
  const now = deps.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  /** Fail a `running` Invocation and eagerly reap its target Agent. */
  async function failAndReap(
    row: { id: string; owner: string },
    reason: string,
  ): Promise<void> {
    await deps.repo.fail(row.id, reason);
    try {
      await deps.agentsFor(row.owner).delete(row.id);
    } catch (err) {
      // Sweepable is the backstop — the Agent Sweep reaps it on hibernate.
      process.stderr.write(
        `[invocation-liveness] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      // 1. Fail Invocations that blew their deadline without reporting.
      const expired = await deps.repo.listExpiredRunning(now(), deps.batchSize);
      for (const row of expired) {
        try {
          await failAndReap(row, "liveness deadline exceeded");
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] fail ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      // 1b. Fail Invocations whose target pod crashed/restarted mid-turn. The
      //     one-shot trigger already fired (recorded in the runtime's persisted
      //     state), so after a restart the prompt is not redelivered and the
      //     turn cannot resume — it would otherwise idle until its deadline.
      const stillRunning = await deps.repo.listRunning(deps.batchSize);
      for (const row of stillRunning) {
        try {
          const restart = await deps.k8s.readAgentPodRestart(row.id);
          if (restart && restart.restarts > 0) {
            await failAndReap(
              row,
              `target pod restarted${restart.reason ? ` (${restart.reason})` : ""}; one-shot turn cannot resume`,
            );
          }
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] restart-check ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      // 2. Drop aged terminal result rows (retention elapsed). The target Agent
      //    is already gone (eager reap / Agent Sweep); this only frees the row.
      const rowDeadline = new Date(now().getTime() - RESULT_RETENTION_MS);
      const aged = await deps.repo.listAgedTerminal(
        rowDeadline,
        deps.batchSize,
      );
      for (const row of aged) {
        try {
          await deps.repo.delete(row.id);
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] drop ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
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
