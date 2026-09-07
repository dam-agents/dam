import { emit, EventType } from "../../../events.js";
import type {
  ExperimentRow,
  ExperimentsRepository,
} from "../infrastructure/experiments-repository.js";

export async function reapRunningExperiment(
  repo: ExperimentsRepository,
  row: ExperimentRow,
  error: string,
  at: Date,
): Promise<boolean> {
  const flipped = await repo.transition(row.id, "running", "failed", {
    finishedAt: at,
    error,
  });
  if (flipped) {
    emit({
      type: EventType.ExperimentChanged,
      experimentId: row.id,
      agentId: row.driverAgentId,
      ownerSub: row.owner,
    });
  }
  return flipped;
}
