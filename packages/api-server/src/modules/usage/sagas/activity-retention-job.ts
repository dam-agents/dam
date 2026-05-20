import { sql, type Db } from "db";
import {
  ACTIVITY_RETENTION_DAYS,
  deleteActivityEventsOlderThan,
} from "../infrastructure/activity-retention.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 60 * 1000;
// Stable across replicas of the same DB so pg_try_advisory_lock dedups multi-replica runs.
const ADVISORY_LOCK_KEY = 0x70_6c_61_74_66; // 'platf' in ASCII

export type ActivityRetentionJob = {
  start(): void;
  stop(): void;
};

/** Weekly bulk DELETE of stale activity_events rows. Multi-replica safe:
 *  competing replicas race a `pg_try_advisory_lock(key)` and only the
 *  winner runs the DELETE — losers no-op. Lock auto-released on session
 *  close. */
export function startActivityRetentionJob(db: Db): ActivityRetentionJob {
  const deleteOld = deleteActivityEventsOlderThan(db);
  let timer: NodeJS.Timeout | null = null;

  async function tick(): Promise<void> {
    try {
      const acquired = await db.execute<{ ok: boolean }>(
        sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS ok`,
      );
      const row = (acquired as unknown as Array<{ ok: boolean }>)[0];
      if (!row?.ok) return;
      try {
        const n = await deleteOld(ACTIVITY_RETENTION_DAYS);
        if (n > 0) {
          process.stderr.write(
            `[usage/retention] deleted ${n} activity_events older than ${ACTIVITY_RETENTION_DAYS}d\n`,
          );
        }
      } finally {
        await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
      }
    } catch (err) {
      process.stderr.write(`[usage/retention] tick failed: ${err}\n`);
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setTimeout(function loop() {
        tick().finally(() => {
          timer = setTimeout(loop, WEEK_MS);
        });
      }, STARTUP_DELAY_MS);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
