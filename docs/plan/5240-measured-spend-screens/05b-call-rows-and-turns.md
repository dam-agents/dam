# 05b — Spend per call and per turn

**Depends on:** 05-session-storage-and-reads
**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

The chat's turn line (`TurnTelemetry`, in the chat view, the delegation card and the docked panel) shows a cost that sums the harnesses' own reports, against decisions 1 and 9.
`spend_daily` sums by day and session, so it cannot give a turn's cost.
Petr agreed on G10 on 2026-10-16: a table `spend_calls` keeps one row per call, and a turn's cost is the sum of the calls of its session that start inside the turn's time range, which the chat already has from telemetry.
This slice adds the table, its writes, its retention job and the read `spend.turns`.
Backend only; slice 06 shows the cost on the turn line.

## Implementation plan

Apply `/typescript-engineering`.
Read [README — The contract](./README.md#the-contract) (`spend.turns`) and [README — Storage](./README.md#storage) first.

1. **Migration.**
   In `packages/db/src/schema.ts`, add `spendCalls`: `call_id text PRIMARY KEY`, `owner_sub text NOT NULL`, `payer_agent_id text NOT NULL`, `calling_agent_id text NOT NULL`, `session_id text NOT NULL DEFAULT ''`, `started_at timestamptz NOT NULL`, `unit text NOT NULL`, `cost_micros bigint NOT NULL`.
   Add an index on `calling_agent_id, session_id, started_at`, and one on `started_at` for the retention job.
   Run `mise run //packages/db:generate -- --name spend_calls` (the next free number) and add a top comment.
2. **Writes** in `packages/api-server/src/modules/spend/`:
   - The ledger port (`infrastructure/spend-ledger.ts`) gets `putCall(row)`: an upsert by `call_id` that sets the call's totals, so a late real record that corrects an estimate overwrites the estimate.
   - `services/spend-ingest.ts` calls it when a call is settled: a final record, the sweep's estimate for a call without a record (`settleUnrecorded`), and a call that the sweep finishes from its periodic records.
     It writes the totals that the call has after the settle, with the row's session and calling agent of slice 05.
     Periodic records and refusals (cost 0) write nothing.
3. **Retention:** a daily periodic job deletes `spend_calls` rows with `started_at` older than 30 days; `periodicJobs` (BullMQ) runs it on one worker, as for the session directory's job.
4. **Read `spend.turns`** as pinned in the README: contract (`api-server-api/src/modules/spend/schemas.ts`, `types.ts`, `router.ts`; `readAgentProcedure` with `checkAgentBinding`), service and ledger query.
   - One query for all windows: the windows as two arrays of instants (`unnest … WITH ORDINALITY`), joined to the agent's rows in the session, grouped by window and unit.
     Pass instants as ISO strings with a cast, not `Date` objects (a `Date` in raw `sql` fails at bind).
   - Refuse more than 200 windows, a window whose end is before its start, and a span of more than 31 days.
5. **Docs.**
   - `docs/architecture/spend-limits.md` § Ledger: the per-call rows, what writes them, their 30-day retention, and that they serve the turn cost only; no limit reads them.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass for `db`, `api-server` and `api-server-api`.
- [ ] After a Claude Code prompt, `spend_calls` has one row per call of that prompt, with the chat's session id, the agent as calling agent and the cost of the call.
- [ ] The sum of a day's `spend_calls` costs of an agent equals the agent's `spend_daily` cost for that day, per unit, for calls made after the deploy.
- [ ] An estimated call that a real record corrects later keeps one row, with the real cost.
- [ ] `spend.turns` with the windows of a session's turns returns each turn's cost; a window with no call returns no amount and 0 calls.
- [ ] The retention job deletes a row whose `started_at` is 31 days old and keeps one that is 29 days old.

## Smoke test

1. Rebuild the api-server and deploy it on the local cluster; the migration runs at start.
2. Run two prompts in a Claude Code chat.
3. In psql: `select call_id, session_id, calling_agent_id, started_at, unit, cost_micros from spend_calls order by started_at desc limit 10;` — one row per call, with the chat's session id.
4. Call `spend.turns` with curl (dev token) with two windows that cover the two prompts: each window returns its prompt's calls.
5. Compare the day's sums of `spend_calls` and `spend_daily` for the agent.
6. In psql, set one row's `started_at` to 31 days ago, run the job (or wait for its next run), and check that the row is gone.

Print a short manual guide for Petr with these steps.
