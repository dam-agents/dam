import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";
import { REPORT_GRACE_MS, type TargetReaper } from "./target-reaper.js";

export interface InvocationLivenessSweep {
  tick(): Promise<void>;
}

export interface TargetRestartState {
  podRestarts: number;
  podRestartReason?: string;
}

export interface CreateInvocationLivenessSweepDeps {
  repo: InvocationsRepository;
  reaper: TargetReaper;
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
    await deps.reaper.reap(row);
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

      const graceEnd = new Date(now().getTime() - REPORT_GRACE_MS);
      const unreaped = await deps.repo.listTerminalUnreaped(
        graceEnd,
        deps.batchSize,
      );
      for (const row of unreaped) await deps.reaper.reap(row);
    } finally {
      running = false;
    }
  }

  return { tick };
}
