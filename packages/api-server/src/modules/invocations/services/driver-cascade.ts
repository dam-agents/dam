import type { AgentsService } from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

/**
 * Driver Cascade: agent-delete cleanup for the Invocations module. Deleting a
 * driver fails its running Invocations and eagerly reaps their targets, so a
 * dangling target — one whose egress would alias to a deleted driver — is
 * structurally unreachable. Chains unwind transitively: reaping a target runs
 * its own cleanup hooks, cascading to any Invocations it drives in turn.
 *
 * The hook also fails the running Invocation *of* the deleted agent itself
 * (a target deleted out-of-band), so the driver's poll settles immediately
 * instead of idling to the liveness deadline. Both writes are conditional on
 * `running`, so the eager-reap paths (recordResult, liveness sweep), which
 * flip the row terminal before deleting the target, pass through as no-ops.
 */
export function createDriverCascade(deps: {
  repo: InvocationsRepository;
  agentsFor: (owner: string) => AgentsService;
}): (agentId: string) => Promise<void> {
  return async (agentId) => {
    await deps.repo.fail(agentId, "target agent deleted");
    const driven = await deps.repo.listRunningByDriver(agentId);
    for (const row of driven) {
      await deps.repo.fail(row.id, "driver agent deleted");
      securityLog("info", "invocation.driver_cascade", {
        category: "resource",
        actor: "system:invocations",
        actorKind: "system",
        agentId: row.id,
        result: "success",
        detail: { driverAgentId: agentId },
      });
      try {
        await deps.agentsFor(row.owner).delete(row.id);
      } catch (err) {
        // Sweepable is the backstop — the Agent Sweep reaps it on hibernate,
        // and its egress fails closed meanwhile (driver identity unresolved).
        process.stderr.write(
          `[driver-cascade] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    }
  };
}
