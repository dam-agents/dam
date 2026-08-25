# `db` — Postgres schema & migrations

The api-server's Postgres state (see [`docs/architecture/persistence.md`](../../docs/architecture/persistence.md)). Two artifacts:

- **`src/schema.ts`** — the table/column/index/enum definitions the application compiles against, in Drizzle ORM. This is the schema the app's queries are type-checked against.
- **`drizzle/`** — the ordered SQL migrations that actually build the database, plus `meta/_journal.json` (their order) and `meta/NNNN_snapshot.json` (Drizzle's model of the schema after each generated migration). Migrations run automatically on api-server startup (`runMigrations`, [`src/migrate.ts`](src/migrate.ts)) — there is no manual migrate step in production.

## The split: tables are generated, views are hand-written

Two kinds of migration, by what's changing (#739, [ADR-063](../../docs/adrs/063-hand-written-migrations.md)):

- **Tables / columns / indexes / enums** live in `schema.ts` and are **generated** with `drizzle-kit generate`. Never hand-write these — `db:check:generated` fails the build if you do (see below).
- **The `usage_*` reporting views** aren't in `schema.ts` (expressing 23 aggregate views in Drizzle's DSL is lossy, and `generate` can't order interdependent views correctly), so they're **hand-written** raw SQL, scaffolded with `db:new`.

### Changing a table

```sh
# 1. edit src/schema.ts
mise run db:generate     # writes drizzle/000N_<name>.sql + meta/000N_snapshot.json + journal entry
# 2. add a top comment to the .sql explaining *why* (reference ADRs if relevant)
mise run check           # type-check + db:check:generated
```

`db:generate` writes the SQL, the journal entry, and the snapshot together — never hand-edit any of them. For destructive changes (drops, renames) review the SQL for safe patterns (`IF EXISTS`, data-preserving renames over drop+recreate).

### Changing a view

```sh
mise run db:new -- add_usage_retention_view   # scaffolds an empty drizzle/000N_<name>.sql + journal entry + snapshot
# write the CREATE/DROP VIEW SQL in it (create views after the views they depend
# on; drop dependents first). Separate statements with `--> statement-breakpoint`.
mise run check
```

`db:new` wraps `drizzle-kit generate --custom`, so it records a snapshot too (a copy of the latest — a view migration changes no tracked table). That snapshot matters: without one for every journal entry, the next `db:generate` has no base to diff against. View migrations don't touch `schema.ts`, so `db:check:generated` ignores them.

## `db:check:generated` — the guard

`mise run db:check:generated` (part of `mise run check`, so it runs locally and in CI) runs `drizzle-kit generate` against `schema.ts` inside a throwaway copy of `drizzle/`: if that would produce a new migration, then `schema.ts` changed without `db:generate` (or a table migration was hand-written) and the check fails. The snapshot only advances when `db:generate` runs, so a clean result proves every table change went through generate. It's a pure file operation — **no database** — which is why it lives in the normal check bundle. Views never enter `schema.ts` or the snapshot, so they're outside its scope.

## The squash: `0000_squashed_baseline.sql` + `0001_usage_views.sql`

The squash collapses the original history (migrations 0000–0022) into two from-scratch migrations: `0000_squashed_baseline.sql` (the table/index/enum DDL, `drizzle-kit generate` output) and `0001_usage_views.sql` (the 23 reporting views, hand-written in dependency order). They're split so the baseline stays purely generated.

Both are safe for existing deployments. The migrator runs a migration only if its journal `when` is **strictly greater** than the newest `created_at` already recorded in `drizzle.__drizzle_migrations`. Both squash migrations' `when` values (`1776084226452` and `1776084226453`) predate every migration an existing deployment has recorded, so they're treated as already-applied and skipped — only fresh installs (empty bookkeeping) run them, tables then views. **Do not change these `when` values.**

> Caveat: this relies on existing deployments being fully migrated to the pre-squash head before the squash ships. A deployment stuck mid-history would skip the baseline without the tail migrations (which no longer exist as files).
