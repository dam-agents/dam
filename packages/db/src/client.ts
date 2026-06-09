import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export interface DbTlsOptions {
  /** PEM CA certificate used to verify the server's TLS certificate (an
   *  external managed DB with a private CA). When set, it is passed as the
   *  client's `ssl` option, scoping trust to this DB connection rather than the
   *  process-global Node trust store. Unset means the connection string's
   *  sslmode governs (system CAs / plaintext). */
  ca?: string | undefined;
}

/** postgres-js `ssl` value for a custom CA, or undefined to let the connection
 *  string's sslmode govern. postgres-js cannot read a CA from the DSN, so it
 *  must come through here. */
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
