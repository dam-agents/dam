# 07 — `get_metrics` and `dam metrics` on measured spend

**Depends on:** 05-session-storage-and-reads
**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

An agent reads its own cost through the `get_metrics` tool, and a person reads an agent's cost with `dam metrics <agent>`.
Both read the agents' own telemetry today, and the totals per sub-agent are wrong ([#4898](https://github.com/dam-agents/dam/issues/4898)).
This slice moves their spend parts to the meter: totals, by model, per session and per sub-agent (decision 8).
The per-call rows (latency, context size) stay on telemetry, without cost (decision 9).
The command is `dam metrics <agent>`; there is no `show` subcommand.

## Implementation plan

Apply `/typescript-engineering` (api-server and CLI).
The output texts are in [README — Wording](./README.md#wording).

1. **An agent-pinned spend read** in the spend module (`packages/api-server/src/modules/spend/`), exported for the metrics module through the composition root, not by a direct import of spend internals:
   `agentSpend({ agentId, from, to, sessionId?, limit })` returns the totals per unit, `byModel`, `modelTimeMs`, the session rows (as `spend.sessions`: each session with the sub-agents spawned from it, and that part apart) and the sub-agent rows.
   - Scope: when the agent is a root driver (`payers.payerOf(agentId) === agentId`), the rows that it pays for; when it is a sub-agent, the rows that it made (`calling_agent_id = agentId`).
   - Sub-agent rows: the rows that the agent pays for with `calling_agent_id` not equal to the agent and not empty, grouped by `calling_agent_id`, with the models, calls, model time, tokens and amounts.
     A grandchild is a row of its own, as before.
   - `sessionId` narrows every part to that session.
2. **`get_metrics`** in `packages/api-server/src/modules/metrics/services/agent-telemetry.ts` (`metrics()`, around lines 124–158):
   - The window is UTC days: today and the `days − 1` days before it (`agentMetricsInputSchema` keeps `days`, 1–30, default 7).
   - `summary`, `session` and `subagent` read `agentSpend`; the result carries `measuredSince` (T), the window's first and last day, totals per unit with a formatted amount (`formatSpendAmount` from the contract), and `byModel` with units.
   - `call` reads `contextPerCall` from telemetry as today, without a cost field; without the telemetry store, only this granularity answers `available: false` with the reason.
   - `totalsCover` says what the totals cover: "Measured spend of this agent and its sub-agents, UTC days ‹from› to ‹to›" for a root driver, "Measured spend of this sub-agent's own calls, …" for a sub-agent.
   - `truncated` stays, from a count that the page cannot fix.
   - `createUnavailableAgentTelemetry` (around lines 197–207) and its wiring (`packages/api-server/src/bootstrap.ts`, around lines 1893–1895) change so that the spend parts answer on a deployment without the telemetry store.
   - Update the tool description in `packages/api-server/src/modules/metrics/mcp-tools.ts`: the cost is measured by the gateway; the per-call rows come from telemetry.
3. **`dam metrics <agent>`** in `packages/cli/src/modules/metrics/commands/show.ts` and `services/metrics-service.ts`:
   - Spend from `spend.breakdown` (`agentId`) and `spend.sessions` for the UTC days that the `--since` window touches; the recent calls from `metrics.overview`'s `contextPerCall`.
     A `PRECONDITION_FAILED` from `metrics.overview` prints the note of the Wording table and does not fail the command.
   - The summary and tables as in the Wording table; amounts with `formatSpendAmount`.
   - `--json` returns `{ agentId, window, measuredSince, totals, byModel, sessions, calls }`.
   - Session titles still come from the sessions port, as today.
4. **Docs.**
   - `docs/architecture/metrics.md` § Agent-facing read: `get_metrics` takes totals, by model, per session and per sub-agent from Metered Spend, pinned to the calling agent by the gateway's identity; the per-call rows come from telemetry, without cost; a sub-agent reads its own calls.
   - `docs/architecture/cli.md` only if it describes the output of `dam metrics`.
5. **#4898:** the pull request body says "Closes #4898", and that the telemetry cause stays unknown (G3).

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass for `api-server`, `api-server-api` and `cli`.
- [ ] `get_metrics` with `granularity: "summary"` gives the same total as `spend.breakdown` for the agent and the same days.
- [ ] A driver's `get_metrics` with `granularity: "subagent"` lists each sub-agent that made a call, by the id that `spawn_subagent` returned.
- [ ] A sub-agent's `get_metrics` gives its own calls.
- [ ] Without the telemetry store, `summary`, `session` and `subagent` answer, and `call` answers `available: false`.
- [ ] `dam metrics <agent>` prints the columns and texts of the Wording table, and `--json` has the new shape.

## Smoke test

1. Rebuild the api-server and the CLI (`packages/cli/dist/js/bin.js`); deploy on the local cluster.
2. In a driver's chat, ask it to spawn a sub-agent that makes one model call, then to call `get_metrics` with `granularity: "subagent"` and then `"summary"`.
3. Compare the summary with `spend.breakdown` for the agent (curl, dev token) for the same days.
4. Run `dam metrics <agent>` and `dam metrics <agent> --json` with a `dev` token in `DAM_TOKEN`.

Print a short manual guide for Petr with these steps.
