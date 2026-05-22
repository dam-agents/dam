import { sql, type Db } from "db";

/** Runs `fn` only if `pg_try_advisory_lock(key)` succeeds. Returns true if
 *  the lock was acquired and `fn` ran; false if another replica held the
 *  lock and we no-op'd. The lock is released in finally; Postgres also
 *  releases session-scoped locks on connection close as a safety net. */
export function withAdvisoryLock(db: Db) {
  return async (key: number, fn: () => Promise<void>): Promise<boolean> => {
    const acquired = await db.execute<{ ok: boolean }>(
      sql`SELECT pg_try_advisory_lock(${key}) AS ok`,
    );
    const row = (acquired as unknown as Array<{ ok: boolean }>)[0];
    if (!row?.ok) return false;
    try {
      await fn();
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${key})`);
    }
    return true;
  };
}
