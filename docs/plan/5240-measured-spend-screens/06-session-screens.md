# 06 — Spend per session on the screens

**Depends on:** 03-usage-pages, 05-session-storage-and-reads
**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

Slice 05 stores the session, the calling agent and the duration of each call.
This slice shows them: the cost line on each session in the chat sidebar, with the part of the sub-agents spawned from it (G5), "Spend by session type" with its "Sub-agents" row on both Usage pages, Model time, the sub-agents on a driver's Usage section, and a sub-agent's own calls on its page (decision 8).
The Bob "Harness spend" card and the session row's fallback to Bob's own count go: both read Bob's own report, and the measured Bobcoins line replaces them (decision 1).

## Implementation plan

Apply `/react-ui-engineering`.
The texts are in [README — Wording](./README.md#wording): the sidebar row (G2), the session types and the agent section.

1. **Sidebar session cost.**
   - In `packages/ui/src/modules/spend/api/queries.ts`, add `useSessionSpend(agentId, sessions)` on `trpc.spend.sessions`, with the paging of today's `useSessionCosts` (`packages/ui/src/modules/metrics/api/queries.ts`, lines 63–84): pages of `SESSION_COST_PAGE_SIZE` from `sessionCostPages()` (`modules/metrics/lib/session-cost-pages.ts`), the newest page polled every 60 s, older pages kept for 5 minutes.
     Turn the page's `from` instant into its UTC day; a page with no `from` reads from T.
   - In `packages/ui/src/modules/sessions/hooks/use-agent-session-list.ts` (line 53), use `useSessionSpend` in place of `useSessionCosts`.
   - In `packages/ui/src/modules/sessions/components/session-row.tsx` (lines 254–268): render the cost as in the Wording table — paid spend "· $0.12" (`formatUsdCell`), plan use only "· $0.40 covered", Bob "· 0.05 Bobcoins" — with the tooltip that lists calls, tokens and each unit, and, when `subAgentAmounts` is above zero, the line about the sub-agents started in this session.
     The cost includes the sub-agents' part (`amounts`).
     Remove the fallback to `s.spend` (the harness's own count).
   - Remove `useSessionCosts` and its types from the UI when nothing else uses them.
2. **Spend by session type** in `MeasuredUsage` (slice 03), on Settings and on the agent section: rows from `bySessionType`, labelled with `SESSION_CATEGORY_LABELS` (`modules/sessions/lib/session-category.ts`), "Sub-agents" for `"subagents"` and "No session" for `"none"`, each of the last two with its `HelpTip`.
   Leave `SessionTypeSpendBars` and its "Unattributed" label as they are for the earlier-estimates view.
3. **Model time:** the stat card "Model time" from `modelTimeMs`, formatted with `formatDurationMs` (`packages/ui/src/lib/format-time.ts`; slice 03 removed `durationSegments`), on both pages.
4. **The agent's sub-agents:** on the agent section, a "Spend by agent" card from `byCallingAgent`, shown only when a sub-agent has spend in the period; the first row is "‹name› (this agent)", then one row per sub-agent, labelled from the app's agent list, else its id.
5. **A sub-agent's own page:** below the limit card's `RootDriverSpendNote` (`AgentSpendLimitCard` renders it for a sub-agent), show `MeasuredUsage agentId={subAgentId}` too (`spend.breakdown` reads its own calls, slice 05) with the line "These are this sub-agent's own calls.
   They count for the limits of ‹root driver›."
6. **The turn line (G10):** `TurnTelemetry` shows the measured cost from `spend.turns` in place of the telemetry `costUsd`, in the units of the [Wording](./README.md#turn-line-slice-06-g10).
   The chat view reads all its turns' windows (`startedAt`, `endedAt`) in one `spend.turns` query for the session; the delegation card and the docked panel read theirs with the sub-agent's id.
   Keep the duration, calls and tokens from telemetry.
7. **Remove the Bob card:** `HarnessSpendCard` (`modules/metrics/components/harness-spend-card.tsx`), `useHarnessSpend` (`modules/metrics/api/harness-spend.ts`) and `HARNESSES_WITH_OWN_SPEND`, and `formatHarnessSpend` when nothing uses it.
   Leave the agent-runtime's `sessions.spend` procedure alone in this slice; slice 08 decides about it.
8. **Docs.**
   - `docs/architecture/metrics.md`: remove § Harness-reported spend; in § Contract, the Session costs read moves to the spend ledger (`spend.sessions`); state that the sidebar shows measured spend per session.
   - `docs/architecture/spend-limits.md` § Screens: the sidebar session cost, spend by session type, Model time and the sub-agent rows read Metered Spend.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/ui:test` pass.
- [ ] A Claude Code, a Codex, a Bob and a Pi session each show a cost in the sidebar, in chat and in terminal mode; a session on the Claude subscription shows "· $… covered".
- [ ] A chat that spawned a sub-agent shows a cost that includes the sub-agent's spend, and its tooltip names that part.
- [ ] The sum of an agent's session costs for today, plus its own "No session" spend, plus the spend of sub-agents without a spawning session, equals the agent's total for today.
- [ ] Spend by session type, with its "Sub-agents" row, adds up to the total on both pages.
- [ ] Model time shows on both pages and grows after a prompt.
- [ ] A driver with a sub-agent shows both under Spend by agent on its section; the sub-agent's page shows its own calls and the line about the root driver.
- [ ] No component reads Bob's own spend count any more.
- [ ] With the telemetry store on, each chat turn line shows the measured cost of its calls; no screen shows the telemetry turn `costUsd`.

## Smoke test

1. Rebuild and deploy the UI and the api-server on the local cluster.
2. Send one prompt each in a Claude Code, a Codex, a Bob and a Pi chat of one agent, and one in a terminal session of each (an agent on the Claude subscription for the "covered" case).
3. Check each sidebar row, and compare with `spend.sessions` (curl, dev token).
4. In one chat, ask the agent to spawn a sub-agent that makes a call: the chat's cost grows by the sub-agent's spend, and the tooltip names that part.
5. Open the agent's Usage section: Model time, Spend by session type with "Sub-agents", and Spend by agent with the sub-agent; open the sub-agent's page.
6. Take screenshots of the sidebar and both Usage pages for the pull request.

Print a short manual guide for Petr with these steps.
