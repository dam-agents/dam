import type { AgentsService } from "api-server-api";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { TargetCapture } from "./target-capture.js";

export const REPORT_GRACE_MS = 5_000;

export interface TargetReaper {
  reap(
    row: { id: string; owner: string },
    opts?: { capture?: boolean },
  ): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one place a target Agent is deleted for its
 * Invocation, which first copies the target's conversation to its root driver
 * unless the root is being deleted too. It never throws, so a timer may fire
 * it unawaited: a delete or mark that fails leaves the row unreaped for the
 * liveness sweep to retry, and a delete that finds no Agent still marks the
 * row, because the target is gone either way.
 */
export function createTargetReaper(deps: {
  repo: InvocationsRepository;
  agentsFor: (owner: string) => AgentsService;
  capture: TargetCapture;
}): TargetReaper {
  return {
    async reap(row, opts) {
      if (opts?.capture !== false) await deps.capture.capture(row);
      try {
        await deps.agentsFor(row.owner).delete(row.id);
        await deps.repo.markReaped(row.id);
      } catch (err) {
        process.stderr.write(
          `[invocations] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    },
  };
}
