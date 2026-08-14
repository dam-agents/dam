import { emit, EventType } from "../../../events.js";
import { sweepDecision } from "../domain/lifecycle.js";
import type { ExperimentsRepository } from "../infrastructure/experiments-repository.js";

export interface ExperimentInactivitySweep {
  tick(): Promise<void>;
}

export interface CreateExperimentInactivitySweepDeps {
  repo: ExperimentsRepository;
  inactivityMs: number;
  batchSize: number;
  onReaped?: (row: {
    id: string;
    owner: string;
    driverAgentId: string;
  }) => Promise<void>;
  now?: () => Date;
}

export function createExperimentInactivitySweep(
  deps: CreateExperimentInactivitySweepDeps,
): ExperimentInactivitySweep {
  const now = deps.now ?? (() => new Date());
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const at = now();
      const cutoff = new Date(at.getTime() - deps.inactivityMs);
      const silent = await deps.repo.listInactiveRunning(
        cutoff,
        deps.batchSize,
      );
      for (const row of silent) {
        try {
          if (
            sweepDecision(
              {
                status: row.status,
                lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
                executedAt: row.executedAt?.toISOString() ?? null,
              },
              at,
              deps.inactivityMs,
            ) !== "fail"
          ) {
            continue;
          }
          const flipped = await deps.repo.transition(
            row.id,
            "running",
            "failed",
            { finishedAt: at, error: "inactivity deadline exceeded" },
          );
          if (flipped) {
            emit({
              type: EventType.ExperimentChanged,
              experimentId: row.id,
              agentId: row.driverAgentId,
              ownerSub: row.owner,
            });
          }
          if (flipped && deps.onReaped) {
            await deps.onReaped({
              id: row.id,
              owner: row.owner,
              driverAgentId: row.driverAgentId,
            });
          }
        } catch (err) {
          process.stderr.write(
            `[experiment-inactivity] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
    } finally {
      running = false;
    }
  }

  return { tick };
}
