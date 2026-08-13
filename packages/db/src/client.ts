import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export interface DbTlsOptions {
  ca?: string | undefined;
}

export function buildDbSsl(tls?: DbTlsOptions): { ca: string } | undefined {
  return tls?.ca ? { ca: tls.ca } : undefined;
}

export function createDb(url: string, tls?: DbTlsOptions) {
  const ssl = buildDbSsl(tls);
  const sql = postgres(url, ssl ? { ssl } : {});
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>["db"];

export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
