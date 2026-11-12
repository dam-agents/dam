import { securityLog } from "../../../core/security-log.js";
import type {
  InvocationRow,
  InvocationsRepository,
} from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";

export interface DelegationStop {
  running(target: InvocationRow): Promise<boolean>;
  stop(
    target: InvocationRow,
    by: {
      reason: string;
      actor: string;
      actorKind: "user" | "agent";
      collectTarget: boolean;
    },
  ): Promise<{ stopped: boolean }>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: one stop for a target and every target below it,
 * whoever asks: each running run in that tree fails with the stop's reason,
 * and each target goes through the one reap path, which removes a one-off
 * target, and with it what it still has below, and ends a kept one's runs
 * on their own, so a kept target keeps its conversation. The walk crosses
 * reaped rows too, so nothing below a removed target is missed. The target's runs
 * fail first, and the tree is read again after each pass until no running
 * run is left in it, so a child a running target spawned while the stop
 * began is stopped too. What stops below the target is collected, so no
 * stopped child wakes its own driver with a turn; the target itself is
 * collected only when its driver asked, since a driver the user overrode
 * still needs to be told. A tree with nothing running is left as it is.
 */
export function createDelegationStop(deps: {
  repo: Pick<
    InvocationsRepository,
    "listRunningRunsOf" | "listTreeOfRoot" | "failStopped"
  >;
  reaper: TargetReaper;
}): DelegationStop {
  async function below(target: InvocationRow): Promise<string[]> {
    const rows = await deps.repo.listTreeOfRoot(target.rootDriverId);
    const childrenOf = new Map<string, string[]>();
    for (const row of rows)
      childrenOf.set(row.driverAgentId, [
        ...(childrenOf.get(row.driverAgentId) ?? []),
        row.id,
      ]);
    const found: string[] = [];
    const seen = new Set([target.id]);
    const queue = [target.id];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const child of childrenOf.get(id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        found.push(child);
        queue.push(child);
      }
    }
    return found;
  }

  async function failAll(
    ids: readonly string[],
    reason: string,
    collected: boolean,
  ): Promise<InvocationRow[]> {
    const failed: InvocationRow[] = [];
    for (const run of await deps.repo.listRunningRunsOf(ids)) {
      if (await deps.repo.failStopped(run.runId!, reason, collected))
        failed.push(run);
    }
    return failed;
  }

  return {
    async running(target) {
      const ids = [target.id, ...(await below(target))];
      return (await deps.repo.listRunningRunsOf(ids)).length > 0;
    },

    async stop(target, by) {
      const stopped = await failAll([target.id], by.reason, by.collectTarget);
      for (;;) {
        const pass = await failAll(await below(target), by.reason, true);
        if (pass.length === 0) break;
        stopped.push(...pass);
      }
      if (stopped.length === 0) return { stopped: false };
      securityLog("info", "invocation.stopped", {
        category: "resource",
        actor: by.actor,
        actorKind: by.actorKind,
        agentId: target.id,
        result: "success",
        detail: {
          driverAgentId: target.driverAgentId,
          runs: stopped.length,
        },
      });
      for (const run of stopped) await deps.reaper.reap(run);
      return { stopped: true };
    },
  };
}
