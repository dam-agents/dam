# 01 — Status from failed gateway calls

**Part of:** Users see when a model provider is down — see [README](./README.md)

## Context

This slice builds the server side of Provider Status from the signal that sees the models: the calls that fail at the agents' gateways.
It works for every provider, so Curve Bender and IBM LiteLLM are covered here.
It adds the domain event, the `provider-status` module with its call window, the evaluate job, the snapshot and the `providerStatus.list` query, and the architecture page.
The UI comes in slices 03–05; this slice is verified through the query.

## Implementation plan

Apply `/typescript-engineering`.
Rules, thresholds and shapes are in [README — Detection](./README.md#detection), [The contract](./README.md#the-contract) and [The event](./README.md#the-event).

1. **Event.** In `packages/api-server/src/events.ts`, add `EventType.GatewayCallEnded`, its type and its place in the `DomainEvent` union, next to `SpendLimitsChanged`.
2. **Emit.** In `packages/api-server/src/modules/spend/services/spend-ingest.ts`, `record(record)`: when `record.final` is true, emit `GatewayCallEnded` before `measureCall`, so a failed call without usage is also emitted.
   Map `payer`, `providers`, `status`, `refusedByGate`, and `endedAt` (`startedAt` + `durationMs`).
   Emit nothing for periodic records.
3. **Domain** in a new `packages/api-server/src/modules/provider-status/domain/`:
   - `outcome.ts`: `outcomeOf(event)` returns `{ templateId, payer, failed }` or `null` for a record that does not count (see README).
     Failed statuses are 500, 502, 503, 504 and 529.
   - `window.ts`: `isDegraded(buckets)` applies the README rule to the 5 one-minute buckets of one template (calls, failures, agents with calls, agents with failures).
   - `status.ts`: `nextSnapshot(previous, signals, now)` builds the snapshot: degraded templates with their `since` (kept from the previous snapshot while the template stays degraded), and the DAM-side state.
     Slice 02 adds the public signals to the same function.
4. **Infrastructure:**
   - `infrastructure/redis-call-window.ts`: per template and minute, a hash with `calls` and `failures`, and two sets (agents with calls, agents with failures), each with a 6-minute expiry.
     Keep a per-minute set of the templates seen, so the job knows which windows to read.
     Use the shared ioredis client (`sharedRedis` in `bootstrap.ts`).
   - `infrastructure/redis-status-snapshot.ts`: read and write one JSON snapshot with a 3-minute expiry.
5. **Saga** `sagas/count-gateway-calls.ts`: subscribe to `GatewayCallEnded`, map it with `outcomeOf`, and write it to the call window.
   Log and continue on a Redis error; never throw into the event stream.
6. **Service** `services/provider-status-service.ts`:
   - `evaluate(now)`: read the windows of the templates seen in the last 5 minutes, compute the snapshot with `nextSnapshot`, and write it.
   - `view()`: read the snapshot and return `ProviderStatusView`; with no snapshot, return no outages and `checkedAt: null`.
7. **Module boundary:** `compose.ts` (`composeProviderStatus({ redis })` returns the service and a `startSaga()` handle) and `index.ts`.
8. **Contract** in a new `packages/api-server-api/src/modules/provider-status/`:
   - `schemas.ts` and `types.ts` with the README types and the `ProviderStatusService` interface (`view(): Promise<ProviderStatusView>`).
   - `router.ts`: `providerStatusRouter` with `list: readAgentProcedure.query(({ ctx }) => ctx.providerStatus.view())`, the same pattern as `budgetsRouter`.
   - Mount it as `providerStatus` in `packages/api-server-api/src/router.ts`, and export the types from `src/index.ts`.
9. **Wiring** in `packages/api-server/src/bootstrap.ts`:
   - compose the module with `sharedRedis` and start its saga;
   - `periodicJobs.register("provider-status-evaluate", 60_000, () => providerStatus.evaluate(new Date()))`;
   - pass the service through `apiServerDeps` to `apps/api-server/trpc/context.ts`, as `providerStatus` in the context (one service for all users).
10. **Docs:**
    - New page `docs/architecture/provider-status.md` (headers per the documentation guidelines, `Last verified:`): Overview, the gateway signal, the detection rules, the snapshot and the job, the query.
    - Link it from `docs/architecture.md` next to spend-limits.
    - `docs/architecture/spend-limits.md` § The record: one sentence that every final record also goes to Provider Status as `GatewayCallEnded`.
    - `docs/ubiquitous-language.md`: the term Provider Status.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/api-server:test` pass; `mise run check:comment-types` passes.
- [ ] A final spend record emits exactly one `GatewayCallEnded`; a periodic record emits none.
- [ ] A failed call without usage still emits the event, and the spend ingest behaves as before.
- [ ] `providerStatus.list` returns no outages while calls succeed.
- [ ] With the rule met for one template, the next job run lists it with reason `failing-calls` and a `since`; the `since` stays the same on later runs.
- [ ] Gate refusals, periodic records, records with no status and multi-template records do not count.
- [ ] When every template with calls is degraded and there are at least 2, `damSide` is set and the templates are not listed as outages.
- [ ] No module imports the internals of another module.

## Smoke test

On the dev cluster, with the api-server and controller images rebuilt and the chart redeployed:

1. Mint a token as in the CLI smoke recipe and call `providerStatus.list` through tRPC: no outages, a recent `checkedAt`.
2. Turn the IBM VPN off.
   Send one message to each of two agents whose Session Pair uses IBM LiteLLM, then a second message each.
3. Within about 2 minutes, `providerStatus.list` lists `ibm-litellm` with reason `failing-calls`.
   The api-server log shows the gateway records with status 503 for those calls.
4. Turn the VPN on, send again, and wait about 6 minutes: the outage is gone.

Print a short guide so Petr can repeat steps 2–4 by hand.
