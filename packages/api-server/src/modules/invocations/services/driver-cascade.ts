import { securityLog } from "../../../core/security-log.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";

export function createDriverCascade(deps: {
  repo: InvocationsRepository;
  reaper: TargetReaper;
}): (agentId: string) => Promise<void> {
  return async (agentId) => {
    const own = await deps.repo.get(agentId);
    if (own) {
      await deps.repo.fail(agentId, "target agent deleted");
      await deps.repo.markReaped(agentId);
    }
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
      await deps.reaper.reap(row);
    }
    if (own === null) await deps.repo.deleteByRoot(agentId);
  };
}
