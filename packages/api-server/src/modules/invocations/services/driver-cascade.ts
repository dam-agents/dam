import { securityLog } from "../../../core/security-log.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { ScriptOutputs } from "./script-outputs.js";
import type { TargetReaper } from "./target-reaper.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a deleted Agent leaves of its delegations. A
 * deleted target fails its own record and its running children, and reaps
 * every child it still has, kept and clean slate ones too, whose
 * conversations are still kept for the root. A deleted root reaps every
 * target of its tree whose Agent may still exist, reported ones included, and
 * only then drops the records whose reap landed. A row whose reap failed stays
 * for the liveness sweep, since no sweep can find a target once its row is gone;
 * so do the rows of a root whose script output could not be purged, for the
 * orphan sweep to purge again.
 */
export function createDriverCascade(deps: {
  repo: InvocationsRepository;
  reaper: TargetReaper;
  outputs: Pick<ScriptOutputs, "purgeRoot">;
}): (agentId: string) => Promise<void> {
  async function failRuns(
    invocationId: string,
    reason: string,
  ): Promise<number> {
    const running = await deps.repo.listRunningRuns(invocationId);
    for (const run of running) await deps.repo.fail(run.runId!, reason);
    return running.length;
  }

  async function failDriven(row: { id: string }, driverAgentId: string) {
    if ((await failRuns(row.id, "driver agent deleted")) === 0) return;
    securityLog("info", "invocation.driver_cascade", {
      category: "resource",
      actor: "system:invocations",
      actorKind: "system",
      agentId: row.id,
      result: "success",
      detail: { driverAgentId },
    });
  }

  return async (agentId) => {
    const own = await deps.repo.get(agentId);
    if (own) {
      await failRuns(agentId, "target agent deleted");
      await deps.repo.markReaped(agentId);
      for (const row of await deps.repo.listUnreapedByDriver(agentId)) {
        await failDriven(row, agentId);
        await deps.reaper.reap(row, { capture: true, force: true });
      }
      return;
    }
    const unreaped = await deps.repo.listUnreapedByRoot(agentId);
    for (const row of unreaped) {
      await failDriven(row, agentId);
      await deps.reaper.reap(row, { capture: false, force: true });
    }
    try {
      await deps.outputs.purgeRoot(agentId);
    } catch (err) {
      process.stderr.write(
        `[invocations] purging ${agentId}'s script output failed, keeping its records for the orphan sweep: ${err instanceof Error ? err.message : err}\n`,
      );
      return;
    }
    await deps.repo.deleteReapedByRoot(agentId);
  };
}
