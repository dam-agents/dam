import { sql, type Db } from "db";

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
