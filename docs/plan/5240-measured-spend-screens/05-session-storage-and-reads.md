# 05 — Spend per session: storage and reads

**Depends on:** 01-measuring-start-and-grouped-read, 04-session-stamp
**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

After slice 04, each spend record carries the session, the harness and the call's duration, and the api-server knows the calling agent from the record stream.
This slice stores the session, the calling agent and the duration in `spend_daily` (decision 10) and gives the reads that slices 06 and 07 need: model time, spend by session type and by calling agent in `spend.breakdown`, and the new `spend.sessions`.
The session is checked at ingest: a session that the calling agent's session directory does not have counts as no session.
The agent's own pod writes that directory, so the check stops stray and wrong ids, not a deliberate agent; such rows stay under that agent and change no total and no limit (G6).
`spend.sessions` also adds to each session the spend of the sub-agents spawned from it, and session types get a "Sub-agents" row (G5).
The harness is not stored: it stays in the record and the logs.
Backend only; slice 06 brings it to the screens.

## Implementation plan

Apply `/typescript-engineering`.
Read [README — Storage](./README.md#storage) and [README — The contract](./README.md#the-contract) first.

1. **Migration.**
   In `packages/db/src/schema.ts` `spendDaily` (around lines 1080–1123):
   - add `session_id text NOT NULL DEFAULT ''`, `calling_agent_id text NOT NULL DEFAULT ''` and `duration_ms bigint NOT NULL DEFAULT 0`;
   - make the primary key `day, payer_agent_id, connection_id, model, session_id, calling_agent_id`;
   - add an index on `calling_agent_id, day` for the per-agent session reads.
     Run `mise run //packages/db:generate -- --name spend_daily_sessions` and add a top comment.
     Rows from before the migration keep empty keys: "no session" and an unknown calling agent.
2. **The ledger row** in `packages/api-server/src/modules/spend/domain/ledger.ts`: `SpendRow` gets `sessionId` and `callingAgentId`; `AMOUNT_FIELDS` gets `durationMs`, and `CallAmounts` and the measuring code carry it (the duration is cumulative per call, like the token counts, so the "add only the difference" rule applies).
3. **The Redis call row** in `packages/api-server/src/modules/spend/infrastructure/call-states.ts`: add both keys to `ROW_FIELDS` and `rowFrom`, and add `m_session` to the call meta that the gate writes (`CallMeta` gets `sessionId: string | null`).
   The row is fixed at a call's first record, so the session check runs once per call.
4. **Writes** in `packages/api-server/src/modules/spend/infrastructure/spend-ledger.ts`: `add` and `addRefusal` use the new conflict target, and `add` sums `duration_ms`.
5. **The session check.**
   - A port `SessionOwnership.has(agentId, sessionId): Promise<boolean>` on the session directory module (`packages/api-server/src/modules/session-directory/`), implemented with the repository's `find([agentId], [sessionId])` (the table's key is agent and session).
     Keep positive answers in a small in-process cache (for example 10 minutes, bounded size); do not cache a miss, because a new session's report can arrive late.
   - In `packages/api-server/src/modules/spend/services/spend-ingest.ts` `record` (around lines 169–213), build the row with `callingAgentId: record.agentId` and `sessionId`: the record's session when `has(record.agentId, session)`, else `""`.
   - In `packages/api-server/src/modules/spend/services/spend-check.ts` `checkCall`: the gate's call carries the session from the `platform.spend` metadata (extend the gate's spend call parsing and `CheckedCall`); a refusal row gets `callingAgentId` = the gate's `agentId` and the checked session; `callStarted` stores the session in `m_session`, so the sweep for calls without a record (`settleUnrecordedCalls`) keeps it.
   - Wire the port in `packages/api-server/src/modules/spend/compose.ts` and `packages/api-server/src/bootstrap.ts`.
6. **Reads.**
   - `spend-ledger.ts` `breakdownRows` (slice 01) also groups by `session_id` and `calling_agent_id`, and sums `duration_ms`.
     When the grouped rows get too many for a long range, split it into two queries (one without the session keys for the totals and per-day rows, one per session for the session-type fold); measure on the dev database first.
   - `domain/breakdown.ts` `foldBreakdown` fills `modelTimeMs`, `bySessionType` and `byCallingAgent`.
     `bySessionType`: a row whose calling agent is not empty and is not its payer is `"subagents"`; the other rows map their session ids to categories with the session directory's `categorize(agentIds, sessionIds)` (`services/session-directory-service.ts`), where `agentIds` are the rows' calling agents; an empty session id, or one that the directory does not know, is `"none"`.
     For a sub-agent's own page (next bullet), its rows are its own calls, so they map by session, not to `"subagents"`.
     `byCallingAgent` is filled only when the input names an agent.
   - Scope in `spend-service.ts` `breakdown`: with an `agentId` whose payer is another agent (`payers.payerOf`), read the rows that it made (`calling_agent_id`) instead of the rows that it pays for.
   - New `spend.sessions` as pinned in the README: contract (`schemas.ts`, `types.ts`, `router.ts`; `readAgentProcedure` with `checkAgentBinding`), service and ledger query.
     - Own rows: grouped by `session_id` over `calling_agent_id = agentId`, rows with a session only.
     - Sub-agent rows (G5): a recursive query over `invocations` (`id`, `driver_agent_id`, `driver_session_id`; `packages/db/src/schema.ts` around line 917) walks from each sub-agent up to the invocation whose driver is `agentId` and takes that invocation's `driver_session_id`; the rows that those sub-agents made (`calling_agent_id`) add to that session, also in `subAgentAmounts`.
       A link without `driver_session_id` stops the walk: that sub-agent's spend belongs to no session.
       Bound the walk by the invocations of the agent's tree (`root_driver_id`, indexed) and by the day range.
     - Order by last day then cost; read `limit + 1` sessions for `truncated`.
     - `from` defaults to T's day (slice 01's `meteringStart`) and `to` to today.
7. **Docs.**
   - `docs/architecture/spend-limits.md` § Ledger: the daily rollup's keys now include the session and the calling agent and a duration counter; the session check at ingest and what it stops (a session that the agent never reported counts as no session; the split is for display only); § Estimates: an estimated or refused call keeps its session and calling agent.
   - `docs/architecture/metrics.md` § Session directory: the spend ledger also reads it, to check a stamped session and to fold spend by session type.
   - `docs/architecture/invocations.md`: the spawning session of a sub-agent also places its spend under that session.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass for `db`, `api-server` and `api-server-api`.
- [ ] After a Claude Code prompt, `spend_daily` has a row with that chat's session id, the agent as `calling_agent_id` and a `duration_ms` above zero.
- [ ] A call with a session id that is not in the agent's session directory lands in a row with an empty `session_id`.
- [ ] A sub-agent's call has the root driver as payer and the sub-agent as calling agent.
- [ ] The spend limits, the ceiling and `spend.status` show the same figures as before the migration (they read sums).
- [ ] `spend.sessions` for an agent: the sum of its rows, plus its own no-session spend, plus the spend of sub-agents without a spawning session, equals the agent's `spend.breakdown` total for the same days.
- [ ] A sub-agent spawned from a chat adds its spend to that chat's row in `spend.sessions`, in `amounts` and in `subAgentAmounts`; a grandchild adds to the same chat.
- [ ] `spend.breakdown` for a driver lists the driver and each sub-agent in `byCallingAgent`, and `bySessionType` (with its `"subagents"` row) adds up to the total.

## Smoke test

1. Rebuild the api-server and deploy it on the local cluster; the migration runs at start.
2. Run one prompt in a Claude Code chat and one in a Pi chat on the same agent; in the Claude Code chat, ask the agent to spawn a sub-agent that makes one model call.
3. In psql: `select session_id, calling_agent_id, duration_ms, cost_micros from spend_daily where day = current_date and payer_agent_id = '<agent>';` — each chat's rows have its session id, and the sub-agent's rows have the sub-agent as calling agent.
4. Call `spend.sessions` and `spend.breakdown` for the agent with curl (dev token): the Claude Code chat's row includes the sub-agent's part, and the sums match the acceptance criteria.
5. Send a stray stamp: from the agent pod, curl the provider through the gateway with `x-platform-session: forged-123` (the Connection placeholder as the credential); the new row has no session.

Print a short manual guide for Petr with these steps.
