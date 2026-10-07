import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { postgresOptions, type DbTlsOptions } from "./client.js";

const MIGRATION_LOCK = "platform-migrations";

export async function runMigrations(
  url: string,
  migrationsFolder: string,
  tls?: DbTlsOptions,
): Promise<void> {
  const sql = postgres(url, postgresOptions(1, tls));
  const db = drizzle(sql);
  try {
    await sql`SELECT pg_advisory_lock(pg_catalog.hashtext(${MIGRATION_LOCK}))`;
    await migrate(db, { migrationsFolder });
  } finally {
    await sql`SELECT pg_advisory_unlock(pg_catalog.hashtext(${MIGRATION_LOCK}))`.catch(
      () => {},
    );
    await sql.end();
  }
}
