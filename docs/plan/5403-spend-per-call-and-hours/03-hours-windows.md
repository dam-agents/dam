# 03 — Spend windows in hours

**Depends on:** 01-call-rows
**Part of:** Spend per model call and for less than a day — see [README](./README.md)

## Context

Spend reads can take a window in hours: the agent's `get_metrics` gets `hours`, `spend.breakdown` and `spend.sessions` take an exact window, and `dam metrics --since` stops widening to whole days.
Inside the call rows' 30 days the read sums `spend_calls`; a window that starts earlier widens to whole days and says so.
Session rows get start and end times from the call rows.

## Implementation plan

Apply **/typescript-engineering** (api-server, api-server-api, cli) and **/react-ui-engineering** (ui).

1. **Contract** (`packages/api-server-api/src/modules/spend/schemas.ts`, `types.ts`): `spendAtWindowSchema`, the `at` alternative on `spendBreakdownInputSchema` and `spendSessionsInputSchema`, `SpendReadWindow` on both results, `firstAt`/`lastAt` on `SpendSessionRow` (README contract). Export `CALL_ROWS_RETENTION_DAYS` from api-server-api so the server and the CLI share it (today in `packages/api-server/src/modules/spend/compose.ts:50`).
2. **Ledger reads** (`spend-ledger.ts`, port in `domain/ledger.ts`): `breakdownCallRows` and `sessionCallRows`, the same grouping and output rows as `breakdownRows` (:306) and `sessionRows` (:375) but over `spend_calls` with `started_at >= fromAt and started_at < toAt`. `sessionRows` also returns `min/max(started_at)` from `spend_calls` for its sessions as `firstAt`/`lastAt` (a left join or a second query; null without rows).
3. **Service** (`spend-service.ts` breakdown/sessions): with `at`, clamp `fromAt` to the measuring start; when it starts before `now − CALL_ROWS_RETENTION_DAYS`, widen to the UTC days it touches and use the day reads; return `window` either way.
4. **`get_metrics`** (`packages/api-server-api/src/modules/metrics/schemas.ts`, `constants.ts`; `packages/api-server/src/modules/metrics/services/agent-telemetry.ts` `utcDaysOf`/`windowFor` :125-160, :182-253): add `hours` (1..720), exclusive with `days`; with `hours`, read through the exact window and describe it as "the last N hours" or, when widened, "UTC days … (whole days: older than the call rows' 30 days)". Session rows carry `firstAt`/`lastAt`. Update the tool text in `mcp-tools.ts`.
5. **CLI** (`packages/cli/src/modules/metrics/domain/spend-window.ts`, `commands/show.ts` :105-140): with `--since`, send `at` instead of widening; print the returned window (hours, or whole days with the note). Session rows show FIRST/LAST times when present, else days.
6. **UI** (`packages/ui/src/modules/spend/lib/amounts-label.ts` `sessionSpendTitle` :33): the session tooltip shows start and end times when `firstAt`/`lastAt` are set, else days.
7. **Docs:** `metrics.md` › agent-facing read (`hours`, the widening note, session times) and `spend-limits.md` › Grouped read / Spend per Session (one sentence each, terse — doc cap).

## Acceptance criteria

- [ ] `get_metrics` with `hours: 2` counts only calls that started in the last two hours; `days` behaves as before; both together is refused.
- [ ] A window that starts more than 30 days ago returns `window.granularity: "day"` and the text says whole days.
- [ ] `dam metrics <agent> --since 2` totals and sessions cover two hours; the header shows the hour window.
- [ ] Session rows (tRPC, CLI, `get_metrics`, UI tooltip) show start and end times for sessions with call rows, days otherwise.
- [ ] `mise run //packages/api-server:test`, `//packages/cli:test`, `//packages/ui:test`, `//docs:check` and `mise run check:comment-types` pass.

## Smoke test

Local cluster (`mise run cluster:build -- api-server`): run two short turns some minutes apart, then `dam metrics <agent> --since 1` and compare with `--since 24`; `--since 800` prints the whole-days note.
Ask the agent for `get_metrics` with `hours: 1`.
Hover a session row's spend in the UI (local Vite) and check the times.
