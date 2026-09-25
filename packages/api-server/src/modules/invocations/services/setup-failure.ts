import type { AgentsService } from "api-server-api";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

export function createSetupFailure(deps: {
  repo: Pick<InvocationsRepository, "get" | "fail">;
  agentsFor: (owner: string) => Pick<AgentsService, "delete">;
}): (agentId: string, step: string, reason: string) => Promise<void> {
  return async (agentId, step, reason) => {
    const row = await deps.repo.get(agentId);
    if (!row || row.status !== "running") return;
    await deps.repo.fail(agentId, `${step} failed: ${reason}`);
    try {
      await deps.agentsFor(row.owner).delete(agentId);
    } catch (err) {
      process.stderr.write(
        `[invocation-setup] reap ${agentId} failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  };
}
