/**
 * Inactivity-deadline sweep for Experiment arms — the liveness guarantee that
 * lets a started Experiment always reach a terminal state (dam-u1n.13).
 *
 * Completion is driven by the harness calling `finish_arm`. But a harness can
 * crash, forget to call it, or hibernate mid-loop (the one-shot Trial prompt is
 * never re-issued, so the arm goes quiet forever). Without a backstop those
 * arms stay `running` and the Experiment never completes.
 *
 * Every `intervalMs` this lists `running` arms whose inactivity clock
 * (`last_activity_at`, reset on each recorded Run) is older than `inactivityMs`
 * and marks each `failed`, flipping the Experiment to `completed` once that was
 * the last non-terminal arm. The clock is re-checked under the row lock inside
 * `failInactiveArm`, so an arm that recorded a Run between listing and reaping
 * is spared.
 *
 * Multi-replica: every replica runs this; `failInactiveArm` is an atomic
 * conditional transition, so a contention race just means the second replica
 * sees the arm already terminal and no-ops. A randomized initial delay keeps
 * replicas from firing the same scan in lockstep.
 */

/** The two repository methods the sweep needs — kept narrow so the saga is
 *  trivially fakeable in tests. `ExperimentsRepository` satisfies it. */
export interface ExperimentArmReaper {
  listInactiveRunningArms(
    deadline: Date,
    limit: number,
  ): Promise<Array<{ experimentId: string; agentId: string }>>;
  failInactiveArm(
    experimentId: string,
    agentId: string,
    deadline: Date,
  ): Promise<boolean>;
}

export interface ExperimentArmSweeper {
  start(): void;
  stop(): Promise<void>;
  /** Run one scan synchronously. Exposed for tests and a future
   *  operator-triggered "sweep now"; `start()` schedules it on a timer. */
  tick(): Promise<void>;
}

export interface CreateExperimentArmSweeperDeps {
  repo: ExperimentArmReaper;
  /** A `running` arm idle this long with no Run and no `finish_arm` is reaped. */
  inactivityMs: number;
  intervalMs: number;
  /** Cap arms reaped per tick; the rest get the next tick. */
  batchSize: number;
  now?: () => Date;
}

export function createExperimentArmSweeper(
  deps: CreateExperimentArmSweeperDeps,
): ExperimentArmSweeper {
  const now = deps.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const deadline = new Date(now().getTime() - deps.inactivityMs);
      const candidates = await deps.repo.listInactiveRunningArms(
        deadline,
        deps.batchSize,
      );
      if (candidates.length === 0) return;
      let reaped = 0;
      for (const { experimentId, agentId } of candidates) {
        try {
          if (await deps.repo.failInactiveArm(experimentId, agentId, deadline))
            reaped += 1;
        } catch (err) {
          process.stderr.write(
            `[experiment-arm-sweeper] failInactiveArm ${experimentId}/${agentId} failed: ${err instanceof Error ? err.message : err}\n`,
          );
        }
      }
      if (reaped > 0)
        process.stderr.write(
          `[experiment-arm-sweeper] reaped ${reaped} inactive arm(s) (${candidates.length} candidate(s))\n`,
        );
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      // Initial delay 0..intervalMs so multi-replica starts don't stack.
      const jitter = Math.floor(Math.random() * deps.intervalMs);
      timer = setTimeout(() => {
        tick().catch(() => {});
        timer = setInterval(() => {
          tick().catch(() => {});
        }, deps.intervalMs);
        timer.unref?.();
      }, jitter);
      timer.unref?.();
    },
    async stop() {
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
        timer = null;
      }
      while (running) await new Promise((r) => setTimeout(r, 50));
    },
  };
}
