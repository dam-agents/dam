import { securityLog } from "../../../core/security-log.js";
import type {
  InvocationRow,
  InvocationsRepository,
} from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";

export interface DelegationStop {
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
 * target and ends a kept one's runs on their own, so a kept target below
 * keeps its conversation and stops spending like the rest. What stops below
 * the target is collected, so no stopped child wakes its own driver with a
 * turn; the target itself is collected only when its driver asked, since a
 * driver the user overrode still needs to be told. A tree with nothing
 * running is left as it is.
 */
export function createDelegationStop(deps: {
  repo: Pick<
    InvocationsRepository,
    "listRunningRuns" | "listUnreapedByDriver" | "failStopped"
  >;
  reaper: TargetReaper;
}): DelegationStop {
  async function below(rootId: string): Promise<InvocationRow[]> {
    const found: InvocationRow[] = [];
    const seen = new Set([rootId]);
    let level = [rootId];
    while (level.length > 0) {
      const next: string[] = [];
      for (const id of level) {
        for (const row of await deps.repo.listUnreapedByDriver(id)) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          found.push(row);
          next.push(row.id);
        }
      }
      level = next;
    }
    return found;
  }

  return {
    async stop(target, by) {
      const tree = [
        { row: target, collected: by.collectTarget },
        ...(await below(target.id)).map((row) => ({ row, collected: true })),
      ];
      const stopped: InvocationRow[] = [];
      for (const { row, collected } of tree) {
        for (const run of await deps.repo.listRunningRuns(row.id)) {
          if (await deps.repo.failStopped(run.runId!, by.reason, collected))
            stopped.push(run);
        }
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
