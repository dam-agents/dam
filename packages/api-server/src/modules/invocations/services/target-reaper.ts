import type { AgentsService } from "api-server-api";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

export const REPORT_GRACE_MS = 5_000;

export interface TargetReaper {
  reap(row: { id: string; owner: string }): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one place a target Agent is deleted for its
 * Invocation. A delete that throws leaves the row unreaped so the liveness sweep
 * retries it; a delete that finds no Agent still marks the row, because the
 * target is gone either way.
 */
export function createTargetReaper(deps: {
  repo: InvocationsRepository;
  agentsFor: (owner: string) => AgentsService;
}): TargetReaper {
  return {
    async reap(row) {
      try {
        await deps.agentsFor(row.owner).delete(row.id);
      } catch (err) {
        process.stderr.write(
          `[invocations] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
        );
        return;
      }
      await deps.repo.markReaped(row.id);
    },
  };
}
