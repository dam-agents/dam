# 01 — Public agent projection and read service

**Part of:** Public Agent Page — see [README](./README.md)

## Context

The Public Agent Page needs an agent's name and its owner's email, for any visitor, with no login.
Agent names live only on the Agent CR, so reading them per page view would let an unauthenticated URL
drive K8s control-plane reads. This slice builds the Postgres projection that stands in front of that,
the machinery that keeps it correct, and the service the HTTP surface will consume. No HTTP surface is
added here.

Apply the **`/typescript-engineering`** skill.

## Implementation plan

### 1. Table

Add to [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts):

```ts
export const agentPublicProfiles = pgTable("agent_public_profiles", {
  agentId: text("agent_id").primaryKey(),
  name: text("name").notNull(),
  ownerSub: text("owner_sub").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
```

`owner_sub` holds the **real** Keycloak sub, not a pseudonym. This is intentional and differs from the
`agents` table two definitions above it, which hashes. `channels.owner` in the same file is the
precedent: real subs already live in this database. Put a comment on the column saying so, because the
adjacent hashed column makes this look like a mistake.

Then:

```sh
mise run db:generate
```

Add a top comment to the generated `packages/db/drizzle/000N_*.sql` explaining why the table exists and
why the sub is unhashed. Never hand-edit the SQL, journal, or snapshot (see
[`packages/db/README.md`](../../../packages/db/README.md)).

### 2. Repository

New file `packages/api-server/src/modules/agents/infrastructure/public-agent-profile-repository.ts`,
following the function-per-query style of the sibling repositories:

- `getProfile(db)` → `(agentId) => Promise<Row | null>`, filtering out `deletedAt is not null`
- `upsertProfile(db)` → `(row) => Promise<void>`, `onConflictDoUpdate` on `agentId`, setting
  `name`, `ownerSub`, `refreshedAt: NOW()`, and clearing `deletedAt`
- `markProfileDeleted(db)` → `(agentId) => Promise<void>`
- `listProfileIdsForReconcile(db)` → `() => Promise<string[]>`, live rows only

Add to [`channel-bindings-repository.ts`](../../../packages/api-server/src/modules/agents/infrastructure/channel-bindings-repository.ts)
an **owner-agnostic** binding check. The existing `listChannelsByAgent(db, owner)` is owner-scoped and
cannot be reused, because the public path has no owner:

```ts
export function hasAnyBinding(db: Db) {
  return async (agentId: string): Promise<boolean> => { /* SELECT 1 ... LIMIT 1 */ };
}
```

`channels_agent_type_idx` already covers this lookup. Export both modules' new functions from
[`modules/agents/index.ts`](../../../packages/api-server/src/modules/agents/index.ts) alongside the
existing repository exports.

### 3. Read service

New file `packages/api-server/src/modules/agents/services/public-agent-page-service.ts`, implementing the
`PublicAgentPageService` contract pinned in the README. Order matters, because it is what keeps K8s out
of the hot path:

1. `hasAnyBinding(agentId)`. If false, return `null` immediately. This is the cheap indexed query and it
   short-circuits every unbound and unknown id with zero further work.
2. `getProfile(agentId)`. If a row exists, use it.
3. **Lazy fill.** No row, but the agent is bound: read the agent from K8s once via the existing agents
   repository, `upsertProfile`, and use it. If K8s says the agent is gone, `markProfileDeleted` (if a row
   exists) and return `null`.
4. Resolve `ownerSub` to an email through the existing
   [`KeycloakUserDirectory.resolveBySub`](../../../packages/api-server/src/modules/agents/infrastructure/keycloak-user-directory.ts),
   which already caches for 60s. On throw or `null`, return `ownerEmail: null` rather than failing the page.

The lazy fill is the **only** backfill. Do not add a boot walk or a migration backfill.

### 4. Saga

New file `packages/api-server/src/modules/agents/sagas/persist-public-agent-profile.ts`, modelled on
[`usage/sagas/persist-agents.ts`](../../../packages/api-server/src/modules/usage/sagas/persist-agents.ts)
(same `events$()` / `ofType` / `mergeMap` shape, same swallow-and-log error handling).

Subscribe to:

- `AgentCreated` and `AgentUpdated` — neither payload carries the name
  ([events.ts](../../../packages/api-server/src/events.ts)), so read the agent back from K8s and upsert.
  Do **not** widen the shared event types to carry a name; other subscribers do not want the field, and
  `AgentUpdated` is deliberately a "something changed, go look" signal. Read-backs happen on mutations,
  which are rare, so this does not undo the point of the projection.
- `AgentDeleted` — `markProfileDeleted`.
- `SlackConnected` — upsert, pre-warming the row at the moment the agent becomes publicly reachable so the
  first click after a bind is warm.

Register it where the other agent-module sagas are started in
[`bootstrap.ts`](../../../packages/api-server/src/bootstrap.ts).

### 5. Reconcile

Register a periodic job in `bootstrap.ts` using the existing `periodicJobs.register` pattern (see
`session-presence-reconcile`, which runs at 60s). Use a much longer interval; names change rarely. Suggest
one hour.

The job iterates `listProfileIdsForReconcile()`, re-reads each agent from K8s, and upserts or marks
deleted. It iterates **existing rows only**. It must not walk `channels` to discover agents to add;
that would make it a backfill and would race lazy fill.

`events$()` is in-process, so the replica that served a mutation is the one that writes the projection.
This reconcile is the only thing that catches a replica dying mid-write, so it is not optional polish.

## Acceptance criteria

- [ ] `agent_public_profiles` exists in `schema.ts` with a generated migration; `mise run db:check:generated` passes
- [ ] The `owner_sub` column carries a comment explaining why it is unhashed
- [ ] `hasAnyBinding` is owner-agnostic and used as the first step of the service
- [ ] `PublicAgentPageService.get` matches the README contract exactly and returns `null` for unknown, unbound, and deleted agents, with no way for a caller to tell them apart
- [ ] A missing row for a bound agent is filled on read; a second call for the same agent performs no K8s read
- [ ] The saga handles `AgentCreated`, `AgentUpdated`, `AgentDeleted`, and `SlackConnected`
- [ ] No event type in `events.ts` gained a field
- [ ] The reconcile iterates existing rows only and never inserts an agent it discovered from `channels`
- [ ] The usage-tracking `agents` table and its repository are untouched
- [ ] `mise run check` and `mise run test` pass

## Smoke test

```sh
mise run db:check:generated
mise run api-server:check
mise run api-server:test
mise run check
```

Then on the dev cluster, confirm the projection fills at bind time:

```sh
mise run cluster:build-apiserver
# bind an agent to a Slack channel through the UI, then:
mise run cluster:kubectl -- exec -it deploy/platform-postgres -- \
  psql -U platform_apiserver -d platform -c \
  "select agent_id, name, owner_sub is not null as has_owner, deleted_at from agent_public_profiles;"
```

A row appears for the agent as soon as it is bound (the `SlackConnected` pre-warm). Rename the agent in
the UI and re-run the query: `name` follows within a moment, via the `AgentUpdated` saga. Delete the
agent: `deleted_at` fills.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
