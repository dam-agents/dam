## Database Migrations (`packages/db`)

Tables/indexes/enums are **generated** from `schema.ts`; the `usage_*` reporting views are **hand-written** raw SQL (they aren't in `schema.ts`) (#739). Full workflow in [`README.md`](README.md).

- **Table change**: edit `src/schema.ts` → `mise run db:generate` (writes the `.sql`, `_journal.json` entry, and snapshot — never hand-edit them) → add a top comment explaining *why*.
- **View change**: `mise run db:new -- <name>` scaffolds the `.sql` + journal entry, then hand-write the `CREATE/DROP VIEW` SQL (dependency order; `--> statement-breakpoint` between statements).
- **`usage_src_*` view change**: recreating a view discards its privileges, so the same migration must re-grant it — `GRANT SELECT ON <view> TO usage_readers`, wrapped in an `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'usage_readers')` guard because the role is absent on most installs. `mise run db:check:usage-src-grants` fails the build if you forget.
- Never hand-write a table migration: `mise run db:check:generated` (part of `mise run check`, no database) fails if the snapshot doesn't match `schema.ts`.

Migrations run automatically on api-server startup — no manual migrate step in production. The squash split the original history into `0000_squashed_baseline.sql` (tables) and `0001_usage_views.sql` (views); existing deployments skip both (do not change their journal `when`). Commit `_journal.json` alongside the `.sql` file.
