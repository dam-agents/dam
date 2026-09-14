# 02 — The record and its read path

**Depends on:** 01-accept-adr
**Part of:** Persist activity feed state reliably — see [README](./README.md)

## Context

The storage half: two tables, the module that owns them, and the owner-scoped read Home will
use. Nothing writes records yet — sub-issue 03 brings the producer — so this slice is verified
by putting a row in by hand and reading it back out. Apply `/typescript-engineering`.

## Implementation plan

### Schema

1. In `packages/db/src/schema.ts`, after the existing session-shaped tables, add:

```ts
export const attentionRecords = pgTable(
  "attention_records",
  {
    agentId: text("agent_id").notNull(),
    sessionId: text("session_id").notNull(),
    ownerSub: text("owner_sub").notNull(),
    mode: text("mode").notNull(),
    type: text("type").notNull(),
    title: text("title"),
    scheduleId: text("schedule_id"),
    experimentId: text("experiment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    activityAt: timestamp("activity_at", { withTimezone: true }),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    working: boolean("working").notNull().default(false),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.sessionId] }),
    index("attention_records_owner_activity_idx").on(table.ownerSub, table.activityAt),
    index("attention_records_activity_idx").on(table.activityAt),
  ],
);

export const attentionState = pgTable(
  "attention_state",
  {
    userSub: text("user_sub").notNull(),
    itemKind: text("item_kind").notNull(),
    itemId: text("item_id").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userSub, table.itemKind, table.itemId] }),
    index("attention_state_user_idx").on(table.userSub),
  ],
);
```

   `attention_records` is keyed by the session's natural key, the way `agent_sessions` is.
   `attention_state` is keyed per user so nothing needs migrating when read state becomes
   per-person; `item_kind` is `"session"` or `"approval"`, and `item_id` is
   `` `${agentId}:${sessionId}` `` or the approval id. The per-user *seen* watermark is a column
   this table gains with the follow-up — do not add an always-null one now.

   No foreign keys: agent-scoped rows never reference the Agent, per
   [persistence](../../architecture/persistence.md).

2. Generate the migration — `mise run //packages/db:generate` — and add a comment at the top of
   the generated SQL saying what it is for and naming #3601. Never hand-write the SQL.

### The module

3. `packages/api-server/src/modules/attention/domain/types.ts` — the row types the repository
   returns, the `ATTENTION_RETENTION_DAYS = 90` constant, and a pure
   `sameRecord(a, b): boolean` that compares everything except `capturedAt`. That predicate is
   the no-op guard sub-issue 03 leans on; keep it here, beside the types, and model it on
   `packages/api-server/src/modules/harness-config/infrastructure/snapshot-repo.ts`.

4. `packages/api-server/src/modules/attention/infrastructure/attention-repository.ts` —
   `createAttentionRepository(db)` returning an interface with:
   - `getRecords(agentId)` and `upsertRecord(row)` (plain upsert; the guard lives in the caller),
   - `listForOwner(ownerSub)` — records for the owner, newest activity first, bounded by a
     sensible limit, left-joined to the caller's `attention_state` rows,
   - `listDismissed(userSub)`,
   - `setDismissed(userSub, kind, id, at)` — upsert on the composite key,
   - `deleteOlderThan(days)` — records whose `activityAt` (falling back to `createdAt`) is older
     than the cutoff, plus the state rows that pointed at them,
   - `listAgentIds()` and `deleteForAgent(agentId)` for the cleanup hooks.

   Follow `packages/api-server/src/modules/approvals/infrastructure/approvals-repository.ts`:
   typed row interfaces, drizzle imported from the `db` package, raw rows mapped at the boundary.

5. `packages/api-server/src/modules/attention/services/attention-service.ts` —
   `createAttentionService({ repo, ownerSub })`. Owner scoping is baked into the closure, never
   a parameter: `listForOwner()` takes no owner argument, exactly like
   `schedules.listForOwner`. Map rows to the wire types and keep the hiding and unread rules out
   of here — the reader derives them.

6. `packages/api-server/src/modules/attention/compose.ts` — `composeAttentionService(deps)` for
   the per-request service, and `composeAttentionRetention(db)` returning a `retentionTick()`,
   mirroring `packages/api-server/src/modules/session-directory/compose.ts`. Export the cleanup
   helpers from `index.ts`.

### The contract

7. `packages/api-server-api/src/modules/attention/types.ts` — `AttentionItem`,
   `DismissedEntry`, `AttentionList` and the `AttentionService` interface, exactly as pinned in
   the README. `schemas.ts` — zod for the `dismiss` input. `router.ts` — `listForOwner` as a
   `readAgentProcedure` with `requireWildcardBinding` (a browser principal, like
   `events.owner`); leave `dismiss` for sub-issue 05.

8. Mount it: `attention: attentionRouter` in `packages/api-server-api/src/router.ts`, and
   `attention: AttentionService` on `ApiContext` in `packages/api-server-api/src/context.ts`.

### Wiring

9. In `packages/api-server/src/bootstrap.ts`: build the per-request service where the other
   per-request services are assembled; register the retention job next to the existing ones —
   `periodicJobs.register("attention-retention", 24 * 60 * 60_000, () => attentionRetentionTick())`;
   and add an `AgentCleanupSource` entry to `agentCleanupSources` (`name: "attention"`,
   `listAgentIds`, `cleanup`) so rows follow their Agent and the orphan sweep backstops it.

## Acceptance criteria

- [ ] `mise run //packages/db:check:generated` passes — schema and committed migration agree.
- [ ] The api-server starts against a fresh database and both tables exist.
- [ ] `attention.listForOwner` returns an empty list for an owner with no rows, and returns a
      hand-inserted row for the owner it belongs to — and not for a different owner.
- [ ] The retention tick deletes a record whose `activity_at` is older than 90 days along with
      its state rows, and leaves a recent one.
- [ ] Deleting an Agent removes its rows.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

On the dev cluster:

```
mise run cluster:build-apiserver
mise run cluster:logs | tail -30                     # migrations applied, no errors
mise run cluster:kubectl -- exec pod/platform-postgres-0 -- \
  psql -U platform -d platform -c '\d attention_records'
```

Insert one row for your own sub and one for a made-up sub, then confirm the owner scoping by
reading the table back and by deleting the agent:

```
mise run cluster:kubectl -- exec pod/platform-postgres-0 -- psql -U platform -d platform \
  -c "insert into attention_records (agent_id, session_id, owner_sub, mode, type, title, created_at, activity_at, seen_at, working) values ('<agent>', 's-1', '<your-sub>', 'chat', 'regular', 'Hand-inserted', now(), now(), now() - interval '1 hour', false);"
```

The row must come back from the query path in sub-issue 04; until then, reading it with `psql`
and confirming the cleanup hook fires on agent delete is the check.
