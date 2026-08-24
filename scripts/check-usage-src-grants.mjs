#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(REPO_ROOT, "packages", "db", "drizzle");
const ROLE = "usage_readers";
const FIRST_GATED_MIGRATION_INDEX = 35;

const migrationIndex = (file) => Number.parseInt(file.slice(0, 4), 10);

const passthroughViewsCreated = (sql) =>
  [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+"?(usage_src_[a-z0-9_]+)"?/gi)].map((m) =>
    m[1].toLowerCase(),
  );

const passthroughViewsGranted = (sql) =>
  new Set(
    [
      ...sql.matchAll(
        new RegExp(
          `GRANT\\s+SELECT\\s+ON\\s+(?:TABLE\\s+)?"?(?:public\\.)?"?(usage_src_[a-z0-9_]+)"?\\s+TO\\s+"?${ROLE}"?`,
          "gi",
        ),
      ),
    ].map((m) => m[1].toLowerCase()),
  );

const ungranted = [];
for (const file of readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  if (migrationIndex(file) < FIRST_GATED_MIGRATION_INDEX) continue;
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const granted = passthroughViewsGranted(sql);
  for (const view of passthroughViewsCreated(sql)) {
    if (!granted.has(view)) ungranted.push({ file, view });
  }
}

if (ungranted.length > 0) {
  for (const { file, view } of ungranted) {
    console.error(`${file}  creates ${view} but does not GRANT SELECT on it TO ${ROLE}`);
  }
  console.error(
    `\n${ungranted.length} passthrough view(s) created without a re-grant.\n\n` +
      `Recreating a view discards its privileges, so the analytics consumer that\n` +
      `reads it through membership in ${ROLE} loses access — silently, until a\n` +
      `nightly export fails. Add to the SAME migration:\n\n` +
      `  DO $$\n` +
      `  BEGIN\n` +
      `    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN\n` +
      `      GRANT SELECT ON <view> TO ${ROLE};\n` +
      `    END IF;\n` +
      `  END $$;\n\n` +
      `The role guard is required, not defensive: ${ROLE} is absent on installs\n` +
      `with no analytics consumer and wherever the chart does not manage Postgres,\n` +
      `and an unguarded GRANT would abort the migration there.\n\n` +
      `See "the passthrough grant guard" in packages/db/README.md.`,
  );
  process.exit(1);
}

console.log(
  `OK: every usage_src_* view created since migration ${FIRST_GATED_MIGRATION_INDEX} is re-granted to ${ROLE}.`,
);
