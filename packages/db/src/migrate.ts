import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { buildDbSsl, type DbTlsOptions } from "./client.js";
import {
  reconcileUsageViewGrants,
  type UsageViewGrants,
} from "./usage-view-grants.js";

export async function runMigrations(
  url: string,
  migrationsFolder: string,
  tls?: DbTlsOptions,
): Promise<UsageViewGrants> {
  const ssl = buildDbSsl(tls);
  const sql = postgres(url, ssl ? { max: 1, ssl } : { max: 1 });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder });
    return await reconcileUsageViewGrants(sql);
  } finally {
    await sql.end().catch(() => undefined);
  }
}
