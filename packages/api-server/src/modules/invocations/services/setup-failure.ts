import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";

export function createSetupFailure(deps: {
  repo: Pick<InvocationsRepository, "get" | "fail">;
  reaper: TargetReaper;
}): (agentId: string, step: string, reason: string) => Promise<string> {
  return async (agentId, step, reason) => {
    const failure = `${step} failed: ${reason}`;
    const row = await deps.repo.get(agentId);
    if (!row || row.status !== "running") return failure;
    await deps.repo.fail(agentId, failure);
    await deps.reaper.reap(row);
    return failure;
  };
}
