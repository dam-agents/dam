import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export interface DbTlsOptions {
  ca?: string | undefined;
}

export function postgresOptions(
  max: number,
  tls?: DbTlsOptions,
): { max: number; ssl?: { ca: string } } {
  return tls?.ca ? { max, ssl: { ca: tls.ca } } : { max };
}

interface DbOptions {
  tls?: DbTlsOptions | undefined;
  poolMax?: number | undefined;
}

export const DEFAULT_DB_POOL_MAX = 32;

export function createDb(url: string, opts?: DbOptions) {
  const sql = postgres(
    url,
    postgresOptions(opts?.poolMax ?? DEFAULT_DB_POOL_MAX, opts?.tls),
  );
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>["db"];

export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
