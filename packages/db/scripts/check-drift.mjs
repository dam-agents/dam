import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { runMigrations } from "../src/migrate.ts";
import * as schema from "../src/schema.ts";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "..", "drizzle");

const baseUrl =
  process.env.DRIFT_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";
const MIG_DB = "drift_mig";
const DECL_DB = "drift_decl";

const urlFor = (db) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};

async function withSql(url, fn) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function fingerprint(sql) {
  const cols = await sql`
    SELECT c.relname AS t, a.attname AS c,
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS notnull,
           pg_get_expr(d.adbin, d.adrelid) AS dflt
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`;
  const cons = await sql`
    SELECT con.conrelid::regclass::text AS t, con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = con.connamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'`;
  const idx = await sql`
    SELECT tablename AS t, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
  const enums = await sql`
    SELECT t.typname, e.enumlabel, e.enumsortorder
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'`;

  const lines = [];
  for (const r of cols)
    lines.push(`col ${r.t}.${r.c} :: ${r.type} ${r.notnull ? "NOT NULL" : "NULL"}${r.dflt ? ` DEFAULT ${r.dflt}` : ""}`);
  for (const r of cons) lines.push(`con ${r.t} ${r.conname} ${r.def}`);
  for (const r of idx) lines.push(`idx ${r.t} ${r.indexname} ${r.indexdef}`);
  const enumLabels = {};
  for (const r of enums) (enumLabels[r.typname] ??= []).push([r.enumsortorder, r.enumlabel]);
  for (const [name, labels] of Object.entries(enumLabels))
    lines.push(`enum ${name} = ${labels.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(",")}`);
  return lines.sort();
}

async function main() {
  await withSql(baseUrl, async (sql) => {
    for (const db of [MIG_DB, DECL_DB]) {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await sql.unsafe(`CREATE DATABASE ${db}`);
    }
  });

  await runMigrations(urlFor(MIG_DB), migrationsFolder);

  const stmts = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  await withSql(urlFor(DECL_DB), async (sql) => {
    for (const s of stmts) await sql.unsafe(s);
  });

  const migFp = await withSql(urlFor(MIG_DB), fingerprint);
  const declFp = await withSql(urlFor(DECL_DB), fingerprint);
  const declSet = new Set(declFp);
  const migSet = new Set(migFp);
  const onlyMig = migFp.filter((l) => !declSet.has(l));
  const onlyDecl = declFp.filter((l) => !migSet.has(l));

  if (onlyMig.length === 0 && onlyDecl.length === 0) {
    console.log("✓ no drift — migrations reproduce schema.ts (views excluded).");
    return;
  }
  console.error("✗ DRIFT DETECTED between migrations and schema.ts:\n");
  if (onlyMig.length) {
    console.error("  Present in MIGRATIONS but not in schema.ts:");
    for (const l of onlyMig) console.error(`    - ${l}`);
  }
  if (onlyDecl.length) {
    console.error("  Required by schema.ts but not produced by MIGRATIONS:");
    for (const l of onlyDecl) console.error(`    + ${l}`);
  }
  console.error(
    "\nReconcile by adding a migration (`mise run db:new`) or fixing schema.ts.",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
