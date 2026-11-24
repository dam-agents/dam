import { sql, type Db, type DbTx } from "db";

export function createXactLock(db: Db) {
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(pg_catalog.hashtext(${key}))`,
      );
      return fn();
    });
}

export type XactLock = ReturnType<typeof createXactLock>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the same serialization for work that must read and
 * write inside the lock's own transaction: the caller is handed the transaction, so
 * what it reads is what its writes settle against, and what it writes lands
 * together. The lock is released with the transaction, and by Postgres when the
 * connection drops.
 */
export function createXactTxLock(db: Db) {
  return async <T>(key: string, fn: (tx: DbTx) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(pg_catalog.hashtext(${key}))`,
      );
      return fn(tx);
    });
}

export type XactTxLock = ReturnType<typeof createXactTxLock>;
