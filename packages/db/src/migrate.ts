import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { buildDbSsl, type DbTlsOptions } from "./client.js";

export async function runMigrations(
  url: string,
  migrationsFolder: string,
  tls?: DbTlsOptions,
): Promise<void> {
  const ssl = buildDbSsl(tls);
  const sql = postgres(url, ssl ? { max: 1, ssl } : { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder });
  await sql.end();
}
