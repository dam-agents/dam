# 01 — Record the entry-point choice

**Part of:** Welcome new users and let them choose how they enter — see [README](./README.md)

## Context

The product needs to report which of the three entry points a new user picks. Nothing records it today, so this slice builds the write path end to end: a tRPC mutation the UI can call, a domain event, one `activity_events` row per choice, and the SQL views that expose the split to the inspector report. It ships before the UI slice so 02 has a real mutation to call.

Read [`docs/architecture/usage-tracking.md`](../../architecture/usage-tracking.md) first — it is the source of truth for this subsystem, and this slice changes it.

Apply the `/typescript-engineering` skill.

## Implementation plan

### 1. Contract — `packages/api-server-api/src/modules/usage/`

New module, following the shape of a small sibling such as `modules/terms/`.

- `schemas.ts` — `entryPointChoiceSchema` as a Zod enum of `"sandbox" | "experiment" | "knowledge-base"`, and `entryPointChosenInputSchema` as an object with a single `choice` field.
- `types.ts` — `EntryPointChoice` inferred from the schema, and a `UsageService` interface with one owner-scoped method taking the choice and returning nothing. The service is composed per user, so the sub is not a parameter.
- `router.ts` — `usageRouter` with one `entryPointChosen` mutation: input `entryPointChosenInputSchema`, body calls the context service and returns nothing.
- `packages/api-server-api/src/context.ts` — add `usage: UsageService` to `ApiContext`.
- `packages/api-server-api/src/router.ts` — add `usage: usageRouter` to `appRouter`.
- `packages/api-server-api/src/index.ts` — export `entryPointChoiceSchema` and the `EntryPointChoice` type, so both the api-server and the UI use one definition.

### 2. Domain event — `packages/api-server/src/events.ts`

- Add `EntryPointChosen` to the `EventType` enum.
- Add the event type: the type tag, `actorSub`, and `choice` typed as `EntryPointChoice` imported from `api-server-api`.
- Add it to the `DomainEvent` union.

### 3. Service — `packages/api-server/src/modules/usage/`

- Add an owner-scoped `composeUsageForOwner(ownerSub)` to `compose.ts` (or its own file under `services/`, matching how the module is organized) returning a `UsageService` whose method calls `emit()` with the event above. It is a pure emit — no database access, no await.
- Wire it in `packages/api-server/src/apps/api-server/trpc/context.ts`, inside the per-user factory, the same way the other owner-scoped modules are composed.

### 4. Write path — `packages/api-server/src/modules/usage/sagas/persist-activity.ts`

Add one subscriber, copying the shape of the existing ones:

- `type: "entry_point_chosen"`
- `actorSub` from the event, `agentId: null`, `surface: "ui"`, `outcome: "success"`
- `payload: { choice: event.choice }`

The whole saga only runs when activity tracking is enabled, so no extra gate is needed. Keep the same `mergeMap` concurrency constant and the same `try`/`catch` that writes to stderr — a failed insert must never break the stream.

### 5. Views — new migration

```sh
mise run db:new -- add_usage_entry_point_views
```

Write two views into the generated file, in this order, following the idioms in `packages/db/drizzle/0001_usage_views.sql`:

- **`usage_entry_point_choices_30d`** — one row per `choice`: total count and distinct users, over the last 30 days, ordered by count.
- **`usage_first_entry_point_by_user`** — each user's **first** choice ever (`DISTINCT ON (actor_sub)` ordered by `occurred_at`), with the timestamp. This is the "what new users pick" view.

Both filter `type = 'entry_point_chosen'`, require `actor_sub IS NOT NULL`, and exclude core-team traffic with `AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)`. Separate the statements with `--> statement-breakpoint`. Give the file a top comment saying what the views answer and why they are hand-written rather than generated — with no ADR reference.

Register both names in `VIEW_NAMES` in `packages/api-server/src/modules/usage/services/report-service.ts`. They are pilot views, not internal helpers, so they must not go in `INTERNAL_VIEWS`.

### 6. Documentation — `docs/architecture/usage-tracking.md`

Follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md).

- Add the new event to the write-path description of `persist-activity`.
- State plainly that this one event is a UI-reported click rather than a server-side domain fact, and why the subsystem carries it anyway — it is the only pipeline that answers "how do people start".
- Adjust the "not product-analytics" framing in the Overview so the page stops contradicting what it now holds.
- Update `Last verified`.

## Acceptance criteria

- [ ] `mise run check` passes, including `db:check:generated` — proof the view migration went through `db:new` and `schema.ts` was untouched.
- [ ] `mise run test` passes.
- [ ] `mise run common:check:comment-types` passes.
- [ ] The three choice strings are defined once, in `api-server-api`, and imported everywhere else — no duplicated string unions.
- [ ] The mutation resolves without waiting on Postgres; the row is written by the saga, off the request path.
- [ ] A failed insert is caught and logged, leaving the subscription alive.
- [ ] `usage-tracking.md` describes the new event and both views, and no longer claims the subsystem holds no product analytics.

## Smoke test

```sh
mise run check
mise run test
```

Then, against a cluster (`mise run cluster:upgrade`):

1. Call the mutation as a signed-in user — from the browser console on the deployed UI, or with the tRPC client used in `packages/e2e/playwright/src/lib/api-client.ts`.
2. `GET /api/usage?view=usage_first_entry_point_by_user` with an inspector bearer token, or `platformUsage.openReport()` in the console, and confirm one row carrying the choice you sent.
3. Repeat with a different choice and confirm `usage_entry_point_choices_30d` counts both.

Note for the check: the report excludes core-team users, so a test account carrying the core realm role produces no rows.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
