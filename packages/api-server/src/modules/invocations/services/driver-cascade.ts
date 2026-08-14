import type { AgentsService } from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

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
        process.stderr.write(
          `[driver-cascade] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    }
  };
}
