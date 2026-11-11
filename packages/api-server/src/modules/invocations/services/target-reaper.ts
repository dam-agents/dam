import type { AgentsService } from "api-server-api";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import type { TargetCapture } from "./target-capture.js";
import type { RunCancel } from "./run-cancel.js";

export interface TargetReaper {
  reap(
    row: { id: string; owner: string; runId?: string | null },
    opts?: { capture?: boolean; force?: boolean },
  ): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one place a target Agent is deleted for its
 * Invocation, which first copies the target's conversation to its root driver
 * unless the root is being deleted too. It never throws, so a timer may fire
 * it unawaited: a delete or mark that fails leaves the row unreaped for the
 * liveness sweep to retry, and a delete that finds no Agent still marks the
 * row, because the target is gone either way. A kept target is left until
 * its keep expiry, and a target with a run still running until that run
 * ends, unless the reap is forced because its driver is being deleted; a run
 * of a kept target that ended while its work may still run is ended on its
 * own.
 */
export function createTargetReaper(deps: {
  repo: Pick<
    InvocationsRepository,
    "get" | "getRun" | "hasRunning" | "markReaped"
  >;
  agentsFor: (owner: string) => AgentsService;
  capture: TargetCapture;
  cancel: Pick<RunCancel, "request">;
  now?: () => Date;
}): TargetReaper {
  const now = deps.now ?? (() => new Date());
  return {
    async reap(row, opts) {
      if (!opts?.force) {
        const current = await deps.repo.get(row.id).catch(() => null);
        const kept = current?.keepUntil;
        if (kept && kept.getTime() > now().getTime()) {
          const run = row.runId
            ? await deps.repo.getRun(row.runId).catch(() => null)
            : null;
          if (run?.cancelPending) await deps.cancel.request(run);
          return;
        }
        if (await deps.repo.hasRunning(row.id).catch(() => false)) return;
      }
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
