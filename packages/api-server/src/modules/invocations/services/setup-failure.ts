import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";

export function createSetupFailure(deps: {
  repo: Pick<InvocationsRepository, "get" | "fail">;
  reaper: TargetReaper;
}): (agentId: string, step: string, reason: string) => Promise<void> {
  return async (agentId, step, reason) => {
    const row = await deps.repo.get(agentId);
    if (!row || row.status !== "running") return;
    await deps.repo.fail(agentId, `${step} failed: ${reason}`);
    await deps.reaper.reap(row);
  };
}
