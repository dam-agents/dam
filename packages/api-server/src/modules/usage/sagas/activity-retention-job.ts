import { ACTIVITY_RETENTION_DAYS } from "../domain/types.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 60 * 1000;
// Stable across replicas of the same DB so pg_try_advisory_lock dedups multi-replica runs.
const ADVISORY_LOCK_KEY = 0x70_6c_61_74_66; // 'platf' in ASCII

export type ActivityRetentionJob = {
  start(): void;
  stop(): void;
};

export type ActivityRetentionDeps = {
  withLock: (key: number, fn: () => Promise<void>) => Promise<boolean>;
  deleteOld: (days: number) => Promise<number>;
};

/** Weekly bulk DELETE of stale activity_events rows. Multi-replica safe:
 *  competing replicas race an advisory lock and only the winner runs the
 *  DELETE — losers no-op. */
export function startActivityRetentionJob(
  deps: ActivityRetentionDeps,
): ActivityRetentionJob {
  const { withLock, deleteOld } = deps;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<void> {
    try {
      await withLock(ADVISORY_LOCK_KEY, async () => {
        const n = await deleteOld(ACTIVITY_RETENTION_DAYS);
        if (n > 0) {
          process.stderr.write(
            `[usage/retention] deleted ${n} activity_events older than ${ACTIVITY_RETENTION_DAYS}d\n`,
          );
        }
      });
    } catch (err) {
      process.stderr.write(`[usage/retention] tick failed: ${err}\n`);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      timer = setTimeout(function loop() {
        tick().finally(() => {
          if (running) timer = setTimeout(loop, WEEK_MS);
        });
      }, STARTUP_DELAY_MS);
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
