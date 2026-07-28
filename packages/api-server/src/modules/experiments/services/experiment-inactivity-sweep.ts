// Inactivity sweep for Experiments v2 — the liveness guarantee that every
// executed Experiment reaches a terminal state. A `running` run whose script
// crashed, hibernated, or just went silent would otherwise stay running
// forever, keeping its driver pinned awake. Every tick, running rows silent
// past the window (no accepted trace event; executedAt as the pre-event
// basis) are reaped to `failed`. Multi-replica safe: each reap is an atomic
// conditional transition, so a contention race no-ops on the already-terminal
// row; jittered start keeps replicas from scanning in lockstep.

import { sweepDecision } from "../domain/lifecycle.js";
import type { ExperimentsRepository } from "../infrastructure/experiments-repository.js";

export interface ExperimentInactivitySweep {
  start(): void;
  stop(): Promise<void>;
  /** Run one scan synchronously. Exposed for tests; `start()` schedules it. */
  tick(): Promise<void>;
}

export interface CreateExperimentInactivitySweepDeps {
  repo: ExperimentsRepository;
  inactivityMs: number;
  intervalMs: number;
  /** Cap rows handled per tick; the rest get the next tick. */
  batchSize: number;
  /** Terminal-transition hook — pin release and the terminal dashboard
   *  snapshot ride here (composed in compose.ts). */
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
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let inFlight: Promise<void> = Promise.resolve();

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
          // Re-check through the pure rule (the SQL scan is the coarse
          // filter), then flip atomically; a lost race just no-ops.
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

  return {
    start() {
      if (timer) return;
      // Random offset so multiple replicas don't scan in lockstep.
      const jitter = Math.floor(Math.random() * deps.intervalMs);
      const schedule = () => {
        timer = setInterval(() => {
          inFlight = tick();
        }, deps.intervalMs);
        timer.unref();
      };
      const first = setTimeout(() => {
        inFlight = tick();
        schedule();
      }, jitter);
      first.unref();
      timer = first;
    },
    async stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight;
    },
    tick,
  };
}
