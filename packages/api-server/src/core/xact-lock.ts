import { sql, type Db } from "db";

/** Cross-replica critical section keyed by an arbitrary string. Takes a
 *  Postgres transaction-scoped advisory lock (`pg_advisory_xact_lock`) on a
 *  hash of `key`, runs `fn`, and releases the lock with the transaction —
 *  same-connection release is structural, and a crashed replica's lock dies
 *  with its connection. Blocking: concurrent callers for the same key queue
 *  in Postgres. Keep `fn` short — it holds a pool connection. */
export function createXactLock(db: Db) {
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
      return fn();
    });
}

export type XactLock = ReturnType<typeof createXactLock>;
