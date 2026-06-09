# ADR-063: Generated table migrations, hand-written views, squashed baseline

**Date:** 2026-06-09
**Status:** Accepted
**Owner:** @jezekra1

## Context

The Postgres migration generator authored each migration by diffing the code's schema against its own saved snapshot of the database. That snapshot drifted out of sync and froze early, so every migration since had been hand-written and the ordering journal hand-edited — error-prone, and it already carried a duplicate-timestamp slip. The root cause was hand-writing *table* changes without updating the snapshot; the generator itself works. Separately, the usage reporting views live only in raw SQL, were never in the schema definitions, and can't be generated (expressing 23 aggregate views in the ORM is lossy, and the generator emits views alphabetically, which breaks the references between them). And nothing verified that the schema the application compiles against matched the database the migrations produce; they could diverge silently — e.g. a column the code treats as required that no migration enforces.

## Decision

Table, index and enum migrations are **generated** from the schema definitions with the existing generator; the reporting **views are hand-written** raw SQL, because they aren't in the schema definitions and the generator can't order interdependent views. The full prior history is squashed into a from-scratch baseline of generated table DDL plus a separate hand-written views migration (kept apart so the baseline stays purely generated), and a file-only guard asserts every schema change was generated.

Rules and boundaries:

- A table/index/enum change is made in the schema definitions and generated; the generator writes the migration SQL, the ordering-journal entry, and the snapshot together, so none of those is ever hand-edited. A view change is hand-written into a scaffolded custom migration; the scaffolder writes the journal entry and a snapshot (a copy of the latest, since a view migration changes no tracked table), so the journal still isn't hand-edited and the next generation has a snapshot to diff against.
- The guard compares the latest committed **snapshot** against the schema definitions. The snapshot only advances when the generator runs, so a match proves every table change went through generation; a mismatch fails the build. It is a file comparison with **no database**, so it runs in the normal check bundle. Views never enter the snapshot, so they are outside its scope — the guarantee is "table migrations are generated," not "every line of SQL was generated."
- The squash migrations (baseline and views) are **already-applied** on every existing deployment and run only on fresh installs. The migrator runs a migration only when its journal timestamp strictly exceeds the newest timestamp already recorded, and both squash timestamps predate every recorded migration, so an up-to-date deployment skips both and keeps its database untouched. This holds only if existing deployments are fully migrated to the pre-squash head before the squash ships — the retired tail migrations no longer exist as files.

## Alternatives Considered

- **Pure hand-written SQL for everything** — unnecessarily manual now that the squash has reset the snapshot to truth; generation works for the table portion, which is most changes.
- **Put the views in the schema definitions too, generate everything** — the generator emits interdependent views in alphabetical order, so a view is created before the one it references and the migration fails to apply; making them independent would mean rewriting every view's body.
- **A drift guard that applies all migrations to a throwaway database and compares to the schema** — catches more (including hand-edited view SQL) but needs a Postgres service in CI and can't run in the database-free local check; the file-only snapshot guard covers the table portion, which is the part that must be generated.
- **Switch migration tools** — deferred; the runtime migrator and the generator are sound, and only the frozen snapshot needed resetting.

## Consequences

- **Easier:** a table change is an edit plus one generate command — no hand-writing DDL, no hand-editing the journal that already produced a duplicate-timestamp slip. The guard catches a schema-vs-migration divergence in CI, with no database, rather than in production.
- **Harder:** there are two authoring paths to keep straight — generate for tables, hand-write for views — and a hand-written view migration must order its `CREATE VIEW`s by dependency itself, since nothing sorts them. The guard proves table changes were generated but not that a committed view migration's SQL is correct; that falls to review and to the migration failing on a fresh install.
- **Committed-to:** the baseline's journal timestamp is load-bearing — it must stay older than every recorded migration, or an existing deployment would re-run the baseline against populated tables. The snapshot is now a checked artifact: it must be committed with every generated migration, because the guard treats it as the record of what has been generated.
