import { sql, type Db } from "db";

/** Cross-replica critical section keyed by a string. Takes a Postgres
 *  transaction-scoped advisory lock (`pg_advisory_xact_lock`) on a hash of
 *  `key`, runs `fn`, and releases the lock with the transaction —
 *  same-connection release is structural, and a crashed replica's lock dies
 *  with its connection. Blocking: concurrent callers for the same key queue
 *  in Postgres. Keep `fn` short — it holds a pool connection.
 *
 *  The key is `hashtext`ed onto 32 bits, so distinct keys can collide and
 *  briefly serialize against each other (and against the hand-picked
 *  constants in `modules/usage/infrastructure/advisory-lock.ts` — the two
 *  helpers share one advisory keyspace). Fine for short sections; don't use
 *  this where a spurious cross-key wait would be a correctness bug. */
export function createXactLock(db: Db) {
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      // pg_catalog-qualified: an unqualified hashtext resolves via
      // search_path, and this function decides a lock identity.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(pg_catalog.hashtext(${key}))`,
      );
      return fn();
    });
}

export type XactLock = ReturnType<typeof createXactLock>;
