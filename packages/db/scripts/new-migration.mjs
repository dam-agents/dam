import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

const rawName = process.argv[2];
if (!rawName) {
  console.error("usage: db:new -- <name>   (e.g. db:new -- add_widget_table)");
  process.exit(1);
}
const name = rawName
  .trim()
  .toLowerCase()
  .replace(/[\s-]+/g, "_")
  .replace(/[^a-z0-9_]/g, "");
if (!name) {
  console.error(`invalid migration name: ${JSON.stringify(rawName)}`);
  process.exit(1);
}

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const entries = journal.entries ?? [];
const last = entries[entries.length - 1];
const idx = entries.length;
const seq = String(idx).padStart(4, "0");
const when = Date.now();

if (last && when <= last.when) {
  console.error(
    `clock skew: new when (${when}) is not after the last entry (${last.when}). Aborting.`,
  );
  process.exit(1);
}

const tag = `${seq}_${name}`;
const sqlPath = join(drizzleDir, `${tag}.sql`);
if (existsSync(sqlPath)) {
  console.error(`refusing to overwrite existing ${tag}.sql`);
  process.exit(1);
}

const template = `-- ${tag}
-- WHY: <describe the change; link the ADR/issue>. Separate statements with "--> statement-breakpoint".

`;
writeFileSync(sqlPath, template);

entries.push({ idx, version: "7", when, tag, breakpoints: true });
journal.entries = entries;
writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n");

console.log(`created drizzle/${tag}.sql and appended journal entry (idx ${idx}).`);
console.log("Next: write the SQL, then run `mise run db:drift`.");
