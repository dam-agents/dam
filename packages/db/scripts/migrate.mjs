import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations } from "../src/migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
await runMigrations(url, join(here, "..", "drizzle"));
console.log("migrations applied.");
