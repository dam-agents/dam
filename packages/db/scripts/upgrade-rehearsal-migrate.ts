import { runMigrations } from "../src/migrate.js";

const [url, migrationsFolder] = process.argv.slice(2);
if (!url || !migrationsFolder) {
  console.error("usage: upgrade-rehearsal-migrate.ts <url> <migrationsFolder>");
  process.exit(2);
}
await runMigrations(url, migrationsFolder);
