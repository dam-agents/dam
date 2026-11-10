import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: fails a target's run for a step that failed. A
 * failure that names the task event it came from fails that run only, so a
 * late outcome of one run never fails another, and a run from before runs
 * had their own rows takes any of its target's events; one that names no
 * event (a setup step of the spawn) fails the target's latest run.
 */
export function createSetupFailure(deps: {
  repo: Pick<InvocationsRepository, "get" | "getRun" | "fail">;
  reaper: TargetReaper;
}): (
  agentId: string,
  step: string,
  reason: string,
  runId?: string,
  sessionId?: string,
) => Promise<string> {
  async function runOf(agentId: string, runId: string | undefined) {
    if (runId === undefined) return deps.repo.get(agentId);
    const run = await deps.repo.getRun(runId);
    if (run) return run.id === agentId ? run : null;
    const latest = await deps.repo.get(agentId);
    return latest?.runId === agentId ? latest : null;
  }

  return async (agentId, step, reason, runId, sessionId) => {
    const failure = `${step} failed: ${reason}`;
    const row = await runOf(agentId, runId);
    if (!row?.runId || row.status !== "running") return failure;
    await deps.repo.fail(row.runId, failure, sessionId ?? null);
    await deps.reaper.reap(row);
    return failure;
  };
}
