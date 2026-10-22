# 01 — Call rows carry the router call id and the call's detail

**Part of:** Spend per model call and for less than a day — see [README](./README.md)

## Context

The backend base for both other slices: the Model Router stamps and exports a call id, the gateway meter copies it, and each `spend_calls` row stores it with the call's Connection, model, tokens, web searches, model time and estimated flag.
No reader changes here.

## Implementation plan

Apply **/typescript-engineering** (agent-runtime, api-server) and follow the Go style of `packages/controller`.

1. **Router stamp and export** (`packages/agent-runtime/src/modules/model-router/`):
   - Add `CALL_HEADER = "x-platform-call"` beside `HARNESS_HEADER` (`services/model-router.ts:38`) and export it from `index.ts` like the others.
   - At the stamp (`model-router.ts` ~:309), make a `randomUUID()` per forwarded call and set `headers[CALL_HEADER]`. Drop any `x-platform-call` the harness sent, as for the other stamps.
   - Carry the id on the exported record and write it as `call.id` in `infrastructure/call-exporter.ts` (attributes ~:88-96).
2. **Meter copy** (`packages/controller/pkg/reconciler/envoy_spend_meter.go`):
   - Add `callStampHeader = "x-platform-call"` (:19-20), the Lua constant (:105-106), and at :453-455 copy it into metadata key `router_call` with the same `stamp()` check.
   - Remove the header before the provider wherever the session/harness stamps are removed.
   - Update the Go tests that pin the generated Lua and the stamp removal.
3. **Metadata parse** (`packages/api-server/src/modules/spend/infrastructure/spend-metadata.ts`): add `routerCallId: string | null` read like `sessionId`.
4. **Migration** (`packages/db`): next free number under `packages/db/drizzle/`. Add to `spend_calls`: `router_call_id text not null default ''`, `connection_id text not null default ''`, `model text not null default ''`, the five token columns and `web_searches`, `duration_ms` (bigint, default 0, same names as `spend_daily`), `estimated boolean not null default false`. Index `(calling_agent_id, router_call_id)`. Update the Drizzle schema (`packages/db/src/schema.ts` `spendCalls`).
5. **Ingest write** (`packages/api-server/src/modules/spend/services/spend-ingest.ts` `putCall` :96-119, and its callers in `settle`/`record`/`settleUnrecorded`): pass the router call id from the call's metadata, the Connection and model from the `SpendRow`, the settled token/web-search/duration amounts and `estimated` (the settled amount counted an estimated call). Extend the `putCall` port type (`domain/ledger.ts`) and `spend-ledger.ts` `putCall` (:501-521); the conflict update sets every new column, so a real record still replaces an estimate.
6. **Docs:** `spend-limits.md` › Meter (one clause: the call stamp is copied like the session) and › Call rows (what a row holds now, and that it serves per-call cost and hours windows). `harness-config.md` › The Model Router: the router stamps `x-platform-call`.

## Acceptance criteria

- [ ] Every call forwarded by the router carries a fresh `x-platform-call`; a harness-sent value never passes.
- [ ] The provider never receives `x-platform-call` (meter removes it).
- [ ] `platform.model_call` records carry `call.id` equal to the stamp.
- [ ] A settled call's `spend_calls` row holds `router_call_id`, Connection, model, tokens, web searches, duration and `estimated`; an estimate later replaced by a real record has `estimated = false`.
- [ ] `mise run //packages/agent-runtime:test`, `//packages/api-server:test`, `//packages/controller:test`, `//packages/db:check` pass; `mise run check:comment-types` passes.

## Smoke test

`mise run //packages/controller:test` and `mise run //packages/api-server:test` (existing meter and ingest suites).
On the local cluster after `mise run cluster:build -- controller api-server agents`: send one chat message, then
`mise run cluster:kubectl -- exec -n platform deploy/platform-postgres -- psql -U platform -c "select router_call_id, model, output_tokens, estimated, cost_micros from spend_calls order by started_at desc limit 3"` (adjust the Postgres workload name to the chart's) shows a non-empty `router_call_id` and the model.
