import type { ExperimentsRepository } from "../infrastructure/experiments-repository.js";
import { reapRunningExperiment } from "./reap-running-experiment.js";

export interface ReapedExperiment {
  id: string;
  owner: string;
  driverAgentId: string;
}

export interface CreateExperimentDriverCleanupDeps {
  repo: ExperimentsRepository;
  onReaped: (row: ReapedExperiment) => Promise<void>;
  now: () => Date;
}

export function createExperimentDriverCleanup(
  deps: CreateExperimentDriverCleanupDeps,
): (driverAgentId: string) => Promise<void> {
  return async (driverAgentId) => {
    for (const row of await deps.repo.listRunningByDriver(driverAgentId)) {
      try {
        const flipped = await reapRunningExperiment(
          deps.repo,
          row,
          "driver agent deleted",
          deps.now(),
        );
        if (!flipped) continue;
        await deps.onReaped({
          id: row.id,
          owner: row.owner,
          driverAgentId: row.driverAgentId,
        });
      } catch (err) {
        process.stderr.write(
          `[experiments-cleanup] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    }
    await deps.repo.deleteDraftsByDriver(driverAgentId);
  };
}
