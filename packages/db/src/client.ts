import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export interface DbTlsOptions {
  ca?: string | undefined;
}

export function buildDbSsl(tls?: DbTlsOptions): { ca: string } | undefined {
  return tls?.ca ? { ca: tls.ca } : undefined;
}

export interface DbPoolOptions {
  max?: number | undefined;
}

export const DEFAULT_DB_POOL_MAX = 32;

export function createDb(
  url: string,
  tls?: DbTlsOptions,
  pool?: DbPoolOptions,
) {
  const ssl = buildDbSsl(tls);
  const max = pool?.max ?? DEFAULT_DB_POOL_MAX;
  const sql = postgres(url, ssl ? { max, ssl } : { max });
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>["db"];

export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
