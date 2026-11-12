import type { AgentsService } from "api-server-api";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

const CANCEL_EVENT_TTL_MS = 60 * 60_000;
const STOP_FALLBACK_MS = 2 * 60_000;

interface CancelledRun {
  id: string;
  owner: string;
  runId: string | null;
  completedAt?: Date | null;
}

export interface RunCancel {
  request(run: CancelledRun): Promise<void>;
  settled(run: CancelledRun): Promise<boolean>;
}

export const invocationCancelEventId = (runId: string): string =>
  `invocation-cancel:${runId}`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: ends the work of one run of a kept target that
 * the platform failed while its turn or script may still run (stopped, timed
 * out, failed to set up), and leaves its other runs alone: the target's
 * runtime is asked to cancel that run's turn or kill its script, and confirms
 * it, which clears the run's cancel mark. A machine that has stopped, or a
 * target that is gone, runs nothing, which clears it too. A runtime that does
 * not take the cancel, or does not confirm it, leaves the mark; once no other
 * run of the target is running and a while has passed, its machine is
 * stopped instead, which keeps its disk for the next run.
 */
export function createRunCancel(deps: {
  repo: Pick<InvocationsRepository, "clearCancel" | "hasRunning">;
  agentsFor: (owner: string) => Pick<AgentsService, "get" | "sleep">;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  now?: () => Date;
}): RunCancel {
  const now = deps.now ?? (() => new Date());

  return {
    async request(run) {
      if (!run.runId) return;
      try {
        await deps.runtimeMutator.bump(run.id, [
          {
            id: invocationCancelEventId(run.runId),
            kind: "invocation-cancel",
            payload: { run: run.runId },
            expiresAt: new Date(now().getTime() + CANCEL_EVENT_TTL_MS),
          },
        ]);
        await deps.runtimeMutator.enqueueAfterCommit(run.id);
      } catch (err) {
        process.stderr.write(
          `[invocations] asking ${run.id} to end run ${run.runId} failed: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    },

    async settled(run) {
      if (!run.runId) return true;
      const agent = await deps.agentsFor(run.owner).get(run.id);
      if (!agent || agent.state === "hibernated") {
        await deps.repo.clearCancel(run.runId);
        return true;
      }
      const waited =
        run.completedAt != null &&
        now().getTime() - run.completedAt.getTime() >= STOP_FALLBACK_MS;
      if (
        waited &&
        !agent.stopRequested &&
        !(await deps.repo.hasRunning(run.id))
      ) {
        try {
          await deps.agentsFor(run.owner).sleep(run.id);
        } catch (err) {
          process.stderr.write(
            `[invocations] stopping ${run.id} after run ${run.runId} was not ended failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      return false;
    },
  };
}
