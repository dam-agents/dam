import type { AgentsService } from "api-server-api";
import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

export interface InvocationLivenessSweep {
  tick(): Promise<void>;
}

const RESULT_RETENTION_MS = 10 * 60 * 1000;

export interface TargetRestartState {
  podRestarts: number;
  podRestartReason?: string;
}

export interface CreateInvocationLivenessSweepDeps {
  repo: InvocationsRepository;
  agentsFor: (owner: string) => AgentsService;
  readTargetRestart: (agentId: string) => Promise<TargetRestartState | null>;
  batchSize: number;
  now?: () => Date;
}

export function createInvocationLivenessSweep(
  deps: CreateInvocationLivenessSweepDeps,
): InvocationLivenessSweep {
  const now = deps.now ?? (() => new Date());
  let running = false;

  async function failAndReap(
    row: { id: string; owner: string },
    reason: string,
  ): Promise<void> {
    await deps.repo.fail(row.id, reason);
    try {
      await deps.agentsFor(row.owner).delete(row.id);
    } catch (err) {
      process.stderr.write(
        `[invocation-liveness] reap ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
      );
    }
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const expired = await deps.repo.listExpiredRunning(now(), deps.batchSize);
      for (const row of expired) {
        try {
          await failAndReap(row, "liveness deadline exceeded");
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] fail ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      const stillRunning = await deps.repo.listRunning(deps.batchSize);
      for (const row of stillRunning) {
        try {
          const restart = await deps.readTargetRestart(row.id);
          if (restart && restart.podRestarts > 0) {
            await failAndReap(
              row,
              `target pod restarted${restart.podRestartReason ? ` (${restart.podRestartReason})` : ""}; one-shot turn cannot resume`,
            );
          }
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] restart-check ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }

      const rowDeadline = new Date(now().getTime() - RESULT_RETENTION_MS);
      const aged = await deps.repo.listAgedTerminal(
        rowDeadline,
        deps.batchSize,
      );
      for (const row of aged) {
        try {
          await deps.repo.delete(row.id);
        } catch (err) {
          process.stderr.write(
            `[invocation-liveness] drop ${row.id} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
    } finally {
      running = false;
    }
  }

  return { tick };
}
