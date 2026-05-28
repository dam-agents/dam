import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(url: string) {
  const sql = postgres(url);
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>["db"];

/** The handle Drizzle passes to a `db.transaction(cb)` callback. Shares
 *  the same query surface as `Db` (insert/select/update/delete/execute)
 *  but is nominally a different type. Repo methods that need to run
 *  inside a caller-owned transaction accept `Db | DbTx` so the call
 *  site doesn't need an `as unknown as Db` cast. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
