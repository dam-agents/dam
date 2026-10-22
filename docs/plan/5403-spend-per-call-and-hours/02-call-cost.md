# 02 — Cost of each model call

**Depends on:** 01-call-rows
**Part of:** Spend per model call and for less than a day — see [README](./README.md)

## Context

With the router call id on both records, the readers that list calls join each call to its `spend_calls` row and show the measured cost, marked when estimated: the turn timeline (`telemetry.turn`), `get_metrics` call rows and the CLI's recent calls.

## Implementation plan

Apply **/typescript-engineering** (api-server, api-server-api, cli) and **/react-ui-engineering** (ui).

1. **Ledger read** (`packages/api-server/src/modules/spend/infrastructure/spend-ledger.ts`, port in `domain/ledger.ts`): `callCosts({ ownerSub, callingAgentIds, routerCallIds })` → map router call id → `{ unit, costMicros, estimated }`, one query on the new index. Expose it through `spend-service.ts`.
2. **Contract** (`packages/api-server-api`): `TelemetryCallCost` and `TelemetryLog.cost` (telemetry `types.ts`); `CallContext.costUsd` → `cost: TelemetryCallCost | null` (metrics `types.ts`). See README contract.
3. **Turn detail** (`packages/api-server/src/modules/telemetry/services/telemetry-service.ts` `turn`): collect `call.id` from the turn's `platform.model_call` logs, read `callCosts`, set `cost` on those logs, and on harness call logs (`CALL_EVENTS` in `domain/group-turns.ts`) whose `request_id` equals a router log's `request_id`. Other logs get `cost: null`. Wire the spend dependency in the telemetry compose.
4. **Call rows** (`packages/api-server/src/modules/metrics/infrastructure/clickhouse-reader.ts` `contextPerCall` ~:380-405 reads `call.id`; `services/agent-telemetry.ts` ~:240-252 stops stripping cost and fills `cost` from `callCosts`). Update the `get_metrics` description and call-row text in `mcp-tools.ts` and `metrics.md`.
5. **CLI** (`packages/cli/src/modules/metrics/commands/show.ts` RECENT CALLS): add a COST column; an estimate prints with a leading `~`; no cost prints `—`.
6. **UI** (`packages/ui/src/modules/telemetry/`): `trace-waterfall.tsx` shows the cost at the right of a call row; `record-detail.tsx` shows it in the detail. Format with the existing spend amount formatter (`packages/ui/src/modules/spend/lib/`), `~` prefix plus a tooltip "Estimated: the provider reported no usage for this call" for an estimate.
7. **Docs:** `agent-telemetry.md` › Progressive disclosure (each call row shows its measured cost) and `spend-limits.md` › Call rows (readers).

## Acceptance criteria

- [ ] In an expanded turn, each router and harness call row shows a cost, and they sum to the turn line's cost (within rounding).
- [ ] An estimated call shows `~` and the tooltip; a call with no row shows nothing.
- [ ] `get_metrics` call rows return `cost` with `estimated`; CLI RECENT CALLS has COST.
- [ ] `mise run //packages/api-server:test`, `//packages/ui:test`, `//packages/cli:test` and `mise run check:comment-types` pass.

## Smoke test

Local cluster (`mise run cluster:build -- api-server`) and a local Vite dev server for the UI: send a message that makes several calls, expand the turn, check the costs.
`mise run //packages/cli:dev -- metrics <agent> --since 1` (or the installed `dam`) lists RECENT CALLS with COST.
Ask the agent to call `get_metrics` with `granularity: "call"` and read the `cost` fields.
