# 01 — Measuring start and the grouped read

**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

The screens need two things that the backend does not give today.
First, the measuring start T, so every screen can say since when ‹Brand› measures (decision 6).
Second, a read of `spend_daily` that splits spend by model and by Connection: `spend.daily` groups only by day, payer and unit.
This slice adds the table for T, its data migration, and two read-only procedures: `spend.metering` and `spend.breakdown` ([README — The contract](./README.md#the-contract)).
It changes no screen.

## Implementation plan

Apply `/typescript-engineering`.

1. **Table for T.**
   - In `packages/db/src/schema.ts`, next to `spendDaily` (around line 1080), add `spendMetering` (`spend_metering`): `id smallint` primary key with default 1 and a check `id = 1`, and `started_at timestamptz NOT NULL`.
     Export it from `packages/db/src/index.ts`.
   - Run `mise run //packages/db:generate -- --name spend_metering`, and add a top comment that says why the table exists.
   - Run `mise run //packages/db:new -- spend_metering_start` and write the data statement in that file, with a top comment:
     insert row 1 with the first `spend_daily` day at 00:00 UTC when the table has rows, else `now()`; do nothing when row 1 exists.
     Use `min(day)` and convert the date to a UTC instant explicitly (`::timestamp AT TIME ZONE 'UTC'`).
   - On production the migration of #3428 (`0078_spend_daily`) runs in the same start, so `spend_daily` is empty and T is the upgrade time.
2. **Ledger reads** in `packages/api-server/src/modules/spend/infrastructure/spend-ledger.ts`:
   - `meteringStart(): Promise<Date>` reads row 1.
     A missing row is a deployment error: throw.
   - `breakdownRows({ ownerSub, agentIds, from, to })`: one query over `spend_daily`, filtered like `daily` (owner, optional payer list, day range), grouped by `day, payer_agent_id, connection_id, provider_template, model, unit`, with the sums of `cost_micros`, the token counts, `web_searches`, `calls` and `estimated_calls`.
3. **Fold** in a new pure domain file `packages/api-server/src/modules/spend/domain/breakdown.ts`: `foldBreakdown(rows, names)` turns the grouped rows into `SpendBreakdown` (`totals` per unit, `byDay`, `byAgent`, `byModel`, `byConnection`).
   Sort `byAgent`, `byModel` and `byConnection` by cost, highest first, per unit.
   Leave `modelTimeMs` at 0, and `bySessionType` and `byCallingAgent` empty; slice 05 fills them.
4. **Contract** in `packages/api-server-api/src/modules/spend/`:
   - `types.ts`: `SpendAmount`, `SpendCounts`, `SpendBreakdown`, `SpendMetering` as pinned in the README; add `breakdown` and `metering` to `SpendService`.
   - `schemas.ts`: `spendBreakdownInputSchema` reuses the shape and the 366-day rule of `spendDailyInputSchema`.
   - `router.ts`: `breakdown` (`readAgentProcedure`, `checkAgentBinding` when `agentId` is set, as `daily`) and `metering` (`readAgentProcedure`, no input).
   - Export the new names from the package index.
5. **Service** in `packages/api-server/src/modules/spend/services/spend-service.ts`:
   - `breakdown` uses `scopedAgents(agentId)` like `daily`, then `foldBreakdown` with Connection names.
   - `metering` reads T once per process (cache the promise), and computes:
     `noticeUntil` = T + 30 days when now is before it and the caller owns a live agent created before T, else null;
     `earlierEstimatesUntil` = T + 30 days when now is before it and the telemetry store is on, else null.
   - New deps: `connectionNames(): Promise<Map<string, string>>`, `ownedAgentCreatedBefore(t: Date): Promise<boolean>`, `telemetryStoreOn: boolean`.
6. **Wiring.**
   In `packages/api-server/src/modules/spend/compose.ts` `forOwner`, and in `packages/api-server/src/apps/api-server/trpc/context.ts` (the `spend: spendForOwner({...})` call near line 414):
   - `connectionNames` as the metrics service gets it (`connections.listConnections()`, near line 360);
   - `ownedAgentCreatedBefore` from `agentsRepo.list(user.sub)` and each agent's creation time;
   - `telemetryStoreOn` = `metricsReader !== null`.
7. **Docs.** In `docs/architecture/spend-limits.md` § Ledger, add a short paragraph "Measuring start": what T is, how the migration sets it, and that the screens read it.
   Slice 02 rewrites § Screens.

## Acceptance criteria

- [ ] `mise run check` passes, including `//packages/db:check:generated`.
- [ ] `mise run test` passes for `api-server`, `api-server-api` and `db`.
- [ ] On the dev database, `spend_metering.started_at` is the first `spend_daily` day at 00:00 UTC; on a fresh database it is the start time of the api-server that ran the migration.
- [ ] `spend.breakdown` for a range: the sum of `totals[unit=usd].costMicros` equals the sum of `spend.daily`'s `usd` rows for the same range and scope.
- [ ] `spend.breakdown` with an `agentId` that the caller does not own fails like `spend.daily`.
- [ ] `spend.metering` returns `noticeUntil` for a user with an agent created before T, and null for a user without one.
- [ ] `earlierEstimatesUntil` is null when the telemetry store is off.

## Smoke test

1. Rebuild and deploy the api-server on the local cluster (`cluster-ops` skill).
2. Check the row: `select * from spend_metering;` in `platform-postgres-0` (`psql -U "$POSTGRES_USER" -d platform`).
3. Mint a `dev`/`dev` token through the `platform-ui` password grant and call the tRPC procedures with curl:
   `spend.metering`, then `spend.breakdown` with `{"from":"<T day>","to":"<today>"}`, then `spend.daily` with the same input.
4. Compare the `usd` total of `spend.breakdown` with the sum of the `spend.daily` rows, and with `select sum(cost_micros) from spend_daily where unit='usd' and day between …` for the same owner.

Print a short manual guide for Petr with the three curl calls and the psql query.
