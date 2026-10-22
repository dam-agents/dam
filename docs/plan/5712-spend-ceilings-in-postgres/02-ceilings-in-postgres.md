# 02 — Ceilings in Postgres, set by operators

**Depends on:** 01-platform-operator-role
**Part of:** Spend ceilings in Postgres, set by platform operators — see [README](./README.md)

## Context

This slice moves the Spend Ceiling from the `UserSpendLimit` custom resource into a `spend_ceilings` table and gives operators the tRPC procedures to manage it.
The gate check and spend status keep their `SpendCeilings.forOwner` port, but its adapter reads Postgres instead of the Kubernetes API, without a cache.
After this slice, the api-server no longer reads `UserSpendLimit` objects; the chart and the controller still define the type until 05.
The contract it creates is pinned in the README ([Contract](./README.md#contract-pinned)); 03 and 04 build on it.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Table** — [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts), right after `spendLimitExtensions`:

   ```ts
   export const spendCeilings = pgTable("spend_ceilings", {
     ownerSub: text("owner_sub").primaryKey(),
     amountMicros: bigint("amount_micros", { mode: "number" }).notNull(),
     setBySub: text("set_by_sub").notNull(),
     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
     updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
   });
   ```

   Export it from the `db` package the way `spendLimits` is exported.
   Generate the migration with `mise run //packages/db:generate` (name it `spend_ceilings`), then run `mise run //packages/db:check:journal` and `mise run //packages/db:check:generated`.
   No data moves: no install in production has a `UserSpendLimit`.

2. **Contract** — [`packages/api-server-api/src/modules/spend/`](../../../packages/api-server-api/src/modules/spend/):
   - `schemas.ts`: change `spendCeilingSourceSchema` to `z.enum(["default", "operator"])`.
     Add `spendCeilingUserSchema` (a union of `{ email: z.string().trim().email() }` and `{ ownerSub: z.string().min(1) }`), `spendCeilingSetInputSchema` (`user`, and `amountMicros: spendLimitAmountSchema.nullable()`), `spendCeilingEntrySchema` and `spendCeilingListSchema`, exactly as the README contract gives them.
   - `types.ts`: the inferred types, and a `SpendCeilingsService` interface with `list(): Promise<SpendCeilingList>` and `set(input: SpendCeilingSetInput): Promise<SpendCeilingEntry | null>`.
   - `router.ts`: nest `ceilings: t.router({ list: operatorProcedure.output(…).query(…), set: operatorProcedure.input(…).mutation(…) })` in `spendRouter`; both call `ctx.spendCeilings`.
   - [`context.ts`](../../../packages/api-server-api/src/context.ts): add `spendCeilings: SpendCeilingsService` to `ApiContext`.
   - Export the new schemas and types from the package index, next to the other spend exports.

3. **Domain** — [`spend/domain/limits.ts`](../../../packages/api-server/src/modules/spend/domain/limits.ts): `SpendCeiling.source` becomes `"default" | "operator"`.

4. **Store** — replace [`spend/infrastructure/user-spend-ceilings.ts`](../../../packages/api-server/src/modules/spend/infrastructure/user-spend-ceilings.ts) with `spend/infrastructure/spend-ceilings.ts`, a Drizzle adapter in the style of [`spend-limits.ts`](../../../packages/api-server/src/modules/spend/infrastructure/spend-limits.ts):
   - Keep the `SpendCeilings` port with `forOwner(ownerSub)`, so [`spend-check.ts`](../../../packages/api-server/src/modules/spend/services/spend-check.ts) and [`spend-service.ts`](../../../packages/api-server/src/modules/spend/services/spend-service.ts) change only their import.
     `forOwner` selects the user's row: a row gives `{ amountMicros, source: "operator" }`, no row gives the default as `{ amountMicros, source: "default" }`, and with no default it gives `null`.
     No cache, no fallback to an old value: an error propagates, and the gate check refuses the call as it does for a failed limits read.
   - Add the writes and the list that the admin service needs: `list()` (all rows), `upsert({ ownerSub, amountMicros, setBySub })` and `clear(ownerSub)`.
     The two writes return the amount before the change (`number | null`), for the audit log line.
     `upsert` sets `updated_at` to `now()` on a conflict, as `spend-limits.ts` does.
   - Delete `CustomObjectReader`, the `userspendlimits` plural and the 60-second cache with the old file.

5. **Admin service** — new `spend/services/spend-ceilings-admin.ts`, `createSpendCeilingsAdmin(deps)` with deps: the store, a users port, and `defaultMicros: number | null`.
   It returns a function that binds the acting operator: `forOperator(operatorSub): SpendCeilingsService`.
   - Users port, in the spend module: `subByEmail(email): Promise<string | null>` and `emailsBySub(subs): Promise<Map<string, string>>`.
     [`bootstrap.ts`](../../../packages/api-server/src/bootstrap.ts) adapts the existing `userDirectory` (`resolveByEmail`, `resolveManyBySub` of [`keycloak-user-directory.ts`](../../../packages/api-server/src/modules/agents/infrastructure/keycloak-user-directory.ts)) to it.
   - `list()`: read all rows, resolve the user and setter subs to emails in one `emailsBySub` call, sort by email then by `ownerSub`, and return `{ defaultMicros, ceilings }`.
   - `set({ user, amountMicros })`: resolve `user` to a sub (`email` through `subByEmail`; `ownerSub` as given).
     An email that resolves to nothing throws `NOT_FOUND`, with a message that names the email.
     A `null` amount clears the row and returns `null`; a number upserts with `setBySub = operatorSub` and returns the entry.
   - After each change, log one line at `info`: event `spend.ceiling_changed` with `operatorSub`, `ownerSub`, `fromMicros` and `toMicros` (`null` for "none").
     Use the shared logger the spend module already uses ([`core/logger.ts`](../../../packages/api-server/src/core/logger.ts)).

6. **Wiring:**
   - [`spend/compose.ts`](../../../packages/api-server/src/modules/spend/compose.ts): drop the `k8s` dep; build the store once from `deps.db` and `deps.defaultCeilingMicros`, pass it to the check and to `forOwner` as before, take the new users port, and add the bound admin factory to `SpendSystem` (for example `ceilingsForOperator`).
   - [`bootstrap.ts`](../../../packages/api-server/src/bootstrap.ts): stop passing `k8s` to `composeSpendSystem`, pass the users adapter, and hand the admin factory to the app deps next to `spendForOwner`.
   - [`apps/api-server/deps.ts`](../../../packages/api-server/src/apps/api-server/deps.ts) and [`apps/api-server/trpc/context.ts`](../../../packages/api-server/src/apps/api-server/trpc/context.ts): add `spendCeilings: ceilingsForOperator(user.sub)` to the context.
     The operator check stays in `operatorProcedure`; the service trusts the bound sub and never reads an operator from the input.
   - Fix the other callers of `ApiContext` that the type checker reports (test fixtures and any second context factory) with the smallest change.

7. **CLI wording** — [`packages/cli/src/modules/spend/commands/status.ts`](../../../packages/cli/src/modules/spend/commands/status.ts): rename the `UserSpendLimit` key of `CEILING_SOURCES` to `operator`, and keep the text "set for you by your operator".
   The type check needs this in the same commit.

8. **Docs** — [`docs/architecture/spend-limits.md`](../../architecture/spend-limits.md) › Spend ceiling: replace the text from "A user's ceiling comes from their UserSpendLimit object" to the end of the section, and the YAML block, with the new facts:
   a platform operator ([security-and-credentials](../../architecture/security-and-credentials.md#identity)) sets a user's ceiling, by the user's email; the api-server keeps one row per user in Postgres with who set it and when, and logs every change; a user without a row gets the chart's default ceiling, which is off at first; the user cannot change it, and can still set an own limit below it; the gate reads the row on each check, so a change applies at the next call; a failed read refuses the call.
   Keep the rest of the section.
   Also update any other page that lists the spend tables or names `UserSpendLimit` as the ceiling's source ([`persistence.md`](../../architecture/persistence.md) if it lists them).
   The Screens text and the CLI text change in 04 and 03.

## Acceptance criteria

- [ ] `git grep -n -i userspendlimit -- packages/api-server packages/api-server-api packages/cli` finds nothing.
- [ ] As an operator, `spend.ceilings.set` with `{ user: { email }, amountMicros }` creates a row with `set_by_sub` = the operator's sub; a second call changes it and moves `updated_at`; `amountMicros: null` deletes it and returns `null`.
- [ ] `spend.ceilings.set` with `{ user: { ownerSub } }` changes or clears that row.
- [ ] `spend.ceilings.list` returns the default and every row, with the emails of the user and the setter, sorted by email.
- [ ] A caller without the operator role, and an API key, get `FORBIDDEN` from both procedures; an unknown email gets `NOT_FOUND`.
- [ ] `spend.status` for the user shows `ceiling.source: "operator"` with a row, `"default"` with no row and a chart default, and `ceiling: null` with neither.
- [ ] At the ceiling, the next model call is refused with the ceiling refusal, with no wait for a cache.
- [ ] Every change writes one `spend.ceiling_changed` log line with both amounts.
- [ ] `mise run check` and `mise run test` pass; `mise run check:comment-types` passes.

## Smoke test

Run it yourself, then print a short guide so the user can repeat it.
On the local dev cluster with this branch's api-server and migration (`cluster-ops` skill), with a fresh `dev` token in `DAM_TOKEN` and a second, non-operator test user:

1. Set: `curl -s -X POST -H "Authorization: Bearer $DAM_TOKEN" -H 'content-type: application/json' -d '{"user":{"email":"<second-user>@platform.local"},"amountMicros":0}' "$DAM_SERVER/api/trpc/spend.ceilings.set"` returns the entry, with `setByEmail` = `dev`'s email.
2. List: `curl -s -H "Authorization: Bearer $DAM_TOKEN" "$DAM_SERVER/api/trpc/spend.ceilings.list"` shows the entry and `defaultMicros`.
3. As the second user, `dam spend status` reads "Spend ceiling (set for you by your operator): $0.00 of $0.00", and a model call from one of their agents is refused with "Spend ceiling reached".
4. As the second user, the `spend.ceilings.list` call returns `FORBIDDEN`.
5. As `dev`, set with an unknown email: `NOT_FOUND`.
6. As `dev`, clear with `"amountMicros":null`: the second user's status falls back to the default (or shows no ceiling).
7. `mise run cluster:kubectl -- logs` on the api-server pod shows one `spend.ceiling_changed` line per change.
