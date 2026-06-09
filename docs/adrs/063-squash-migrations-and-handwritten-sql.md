# ADR-063: Squash migration baseline, hand-written SQL workflow, and a drift check

**Date:** 2026-06-09
**Status:** Accepted
**Owner:** @JanPokorny

## Context

The api-server's Postgres schema is defined with Drizzle ([`packages/db/schema.ts`](../../packages/db/src/schema.ts)) and migrated by the drizzle-orm migrator on api-server startup. Authoring migrations had broken down completely:

- **The generator was unusable.** `drizzle-kit generate` authors a migration by diffing `schema.ts` against its own saved snapshot of the database. That snapshot froze at migration `0009` while the schema grew to `0022`, so the generator produced nonsense. Worse, under this repo's pnpm layout `drizzle-kit` could not even resolve `drizzle-orm` (its bundled `import("drizzle-orm/version")` looks beside the `drizzle-kit` install, where `drizzle-orm` isn't linked), so the command died before doing anything. Every migration since `0010` was hand-written and the journal (`meta/_journal.json`) hand-edited — error-prone enough that it had already accrued a near-duplicate timestamp.

- **Views can't be modeled.** A large set of `usage_*` reporting views (raw SQL, partial indexes, JSON expressions, view-on-view) lives only in migrations. Drizzle cannot round-trip them, so even a repaired snapshot could never reproduce the database.

- **Nothing verified schema vs. database.** The schema the code compiles against and the database the migrations produce could silently diverge. They had: the `agent_skill_publishes` primary key was still named `instance_skill_publishes_pkey` (a leftover from before [ADR-046](046-eliminate-instance.md) renamed the table) where `schema.ts` implies `agent_skill_publishes_pkey`.

## Decision

Treat **hand-written SQL as the sanctioned migration workflow**, squash the history to a single baseline, and add an automated check that the migrations still reproduce `schema.ts`.

- **Squash to one baseline.** [`0000_baseline.sql`](../../packages/db/drizzle/0000_baseline.sql) reproduces the entire current schema — tables, indexes, the enum, **and** the views — built from a dump of the database the `0000`–`0022` history produces, so it is an exact reproduction (including historical column order and the legacy constraint name). The originals and all drizzle-kit snapshots are deleted; `meta/_journal.json` is the only metadata that remains (the migrator needs only the journal plus the `.sql` files).

- **The squash is safe for existing deployments by construction.** The drizzle-orm migrator runs a journal entry only when its `when` timestamp is greater than the newest `created_at` recorded in `drizzle.__drizzle_migrations`; the stored file hash is never compared, and all pending entries run in a single transaction (so no database is ever partially migrated). The baseline keeps the original `0000` timestamp, so any database that already ran the old history has a newer recorded `created_at` and **skips the baseline**; only fresh installs execute it. No deployment re-runs DDL it already has.

- **Reconcile discovered drift with a migration, not an exception.** [`0001_rename_skill_publishes_pk.sql`](../../packages/db/drizzle/0001_rename_skill_publishes_pk.sql) renames the legacy constraint. It runs on every deployment — fresh installs reach the legacy name via the baseline, existing databases already carry it — so all converge on the name `schema.ts` implies and the drift check passes with no carve-outs.

- **Scaffold new migrations.** `mise run db:new -- <name>` creates the next numbered `.sql` file and appends its journal entry (`when = Date.now()`, strictly after every shipped migration), so the ordering file is never hand-edited.

- **Guard with a drift check.** `mise run db:drift` applies all migrations to a throwaway database (via the same `runMigrations` path the api-server uses), renders `schema.ts` into a second throwaway database (`drizzle-kit/api`, which works programmatically — `drizzle-orm` is made resolvable to `drizzle-kit` via a `pnpm.packageExtensions` entry), and compares their structure. The comparison is column-order-insensitive and **excludes views** (the one thing `schema.ts` legitimately can't model). It runs in its own CI job with a Postgres service — not in `mise run check`, which stays a static, database-free lint/type/format pass (and the pre-commit hook).

## Alternatives Considered

- **Switch migration tools (Atlas, custom runner, etc.).** Considered and deferred. The drizzle-orm *migrator* is fine; only the *generator* didn't fit. Keeping the migrator and dropping the generator is far less disruptive than re-platforming, and the api-server's startup migration path is unchanged.
- **Model the views in `schema.ts` (drizzle `pgView`).** Drizzle can't faithfully round-trip these views (Postgres rewrites the definitions, producing perpetual spurious diffs), which is the whole reason raw SQL is sanctioned.
- **Leave the legacy constraint name and exclude constraint names from the check.** Rejected — it permanently weakens the check (it could no longer catch real constraint drift) and leaves a misleading `instance_` name post-[ADR-046](046-eliminate-instance.md). A one-line rename is cheaper and stronger.
- **Snapshot-equality check (`drizzle-kit generate` produces no diff).** Rejected — it compares `schema.ts` to a saved snapshot, not to the database the migrations actually build, so it can't catch a hand-written migration that diverges from the schema. The throwaway-database round-trip can.
