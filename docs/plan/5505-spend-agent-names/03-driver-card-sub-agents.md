# 03 — The driver's card names and caps sub-agents

**Depends on:** 01-sub-agent-row-names
**Part of:** Spend by agent names every agent — see [README](./README.md)

## Context

Slice 01 names a sub-agent row by the first line of its task and lists every sub-agent that spent in the period, flat beside the driver's own row.
Three problems came up in its review:

- The first line is long and is cut to about 20 characters in the card, and drivers that open each prompt with the same preamble give rows that read the same.
  [invocations](../../architecture/invocations.md) says that a spawn's label names the target wherever agents are listed, and neither the delegation card nor the spend row uses it.
- The rows look like siblings of the driver, not its sub-agents.
- The list grows with every spawn: one root driver can hold up to 10,000 Invocation links, and naming the rows reads every sub-agent's Invocation record.

After this slice, a sub-agent is named by its label, else by the first line of its task, in the chat and in the card, and its full task shows on hover.
The driver's card shows the driver's own row, then the five sub-agents that cost the most, indented, then one "N more sub-agents" row with the sum of the rest.
"Show all" lists every sub-agent in the same order, 50 at a time.
Settings › Usage and Home do not change: they list one row per paying agent and no sub-agents.

## Implementation plan

Apply `/typescript-engineering` to steps 1–4 and `/react-ui-engineering` to steps 5–8.

1. **Label-first name.**
   Change `delegationTitle` in `packages/api-server-api/src/modules/invocations/delegation-title.ts` to take `{ label, prompt }`: the trimmed label when it is not blank, else the first non-blank line of the prompt, trimmed, or `""`.
   Make `delegation-card.tsx` and `docked-delegation-panel.tsx` pass the node; the card keeps `title={node.prompt}` on its title.

2. **Contract.**
   In `packages/api-server-api/src/modules/spend/types.ts`, add `agentTask: string | null` to the `byCallingAgent` rows and `otherSubAgents: { count: number; amounts: (SpendAmount & { calls: number })[] }` to `SpendBreakdown` (see the pinned contract in the README).
   Add the `subAgents` read to `SpendService` and to the spend router, with its input schema in `schemas.ts` beside the `sessions` one: `agentId`, `from`, `to`, `offset` (from 0) and `limit` (1 to 50, default 50).
   Keep the page size in one exported constant, as `SPEND_SESSIONS_DEFAULT_LIMIT` is kept.
   It uses the same procedure kind and owner check as `breakdown`.

3. **Cap in the domain.**
   In `packages/api-server/src/modules/spend/domain/breakdown.ts`, in the driver's scope only (`scope === "payer"`):
   - keep every `byCallingAgent` entry of the driver itself;
   - rank the sub-agents (each calling agent that is not the payer, all its units together) by dollars (`usd` plus `usd_list`), then Bobcoins, then calls, then id, and keep the first five;
   - sum the entries of the rest per unit into `otherSubAgents`, with `count` the number of sub-agents left out.

   In the owner and caller scopes, `otherSubAgents` is `{ count: 0, amounts: [] }`.
   Keep the cap in one named constant.
   Put the ranking in one domain function that both the cap and the `subAgents` read use, so the two orders cannot drift.

4. **Names and tasks for the kept ids only.**
   In `breakdown()` of `packages/api-server/src/modules/spend/services/spend-service.ts`, fold and cap first, then read the names for the agent ids that the result keeps (the `byAgent` payers and the kept `byCallingAgent` ids), and attach them.
   The Invocation reader in `packages/api-server/src/modules/invocations/infrastructure/invocation-titles.ts` selects `label` and `prompt`, and returns per id the name (`delegationTitle`) and the task (the prompt); it leaves out an id whose name is empty.
   `agentTask` is the task for a sub-agent, else `null`.
   The name order stays as it is: sub-agent name, live name, last known name.
   `subAgents()` reads the driver's rows as `breakdown()` does, ranks the sub-agents with the same function, cuts the page, and reads names and tasks only for the page's ids.
   For an agent that is not a driver, it returns `{ count: 0, rows: [] }`.

5. **Row hover text and indent.**
   Give `RowSource` and `SpendRow` (`packages/ui/src/modules/spend/lib/spend-rows.ts`) an optional hover text, and let `SpendRowList` show it as the label's `title` instead of the label.
   Let `SpendRowList` indent a row: by the 16 px icon slot and the row's `gap-1.5`, so that the indented row's icon sits under the driver's name.

6. **The driver's card.**
   In `packages/ui/src/modules/spend/components/measured-breakdown-cards.tsx`, the driver card shows:
   - the driver's row first, as now;
   - each kept sub-agent row indented, with the Bot icon in its 16 px slot, `agentName ?? DELETED_AGENT_NAME` as the label and `agentTask` as the hover text;
   - when `otherSubAgents.count > 0`, one indented row with no icon, labelled `"1 more sub-agent"` or `"<count> more sub-agents"` (copy in `lib/copy.ts`), with the summed amounts.

   The card shows when any sub-agent row or `otherSubAgents` has spend.
   The owner card does not change.

7. **Show all.**
   When `otherSubAgents.count > 0`, a text button under the list reads "Show all <N> sub-agents", where N is the kept sub-agents plus `otherSubAgents.count`.
   It is styled as the tool chip's "Show all N lines" button (`tool-chip.tsx`).
   A click swaps the top five and the "N more" row for the pages of `spend.subAgents`, read with an infinite query, 50 sub-agents a page; while sub-agents are left, a "Show 50 more" button (or "Show <rest> more" when fewer are left) reads the next page.
   "Show less" goes back to the top five and the "N more" row.
   The expanded state is local to the card; the list is server state and stays in the query cache.
   Rows from the pages use the same name, icon, indent and hover text as the top five.

8. **Home and Settings › Usage.**
   No change: they read `byAgent`, which has no sub-agent rows.

9. **Docs.**
   - `docs/architecture/spend-limits.md`, Grouped read: a sub-agent takes its label, else the first line of its task; in a driver's read, the api-server keeps the five sub-agents that cost the most and sums the rest; a paged read lists them all in the same order, 50 a page.
   - `docs/architecture/spend-limits.md`, Screens: a driver's Usage section shows its sub-agents indented under its own row, the five that cost the most and one "N more sub-agents" row, with each task on hover, and "Show all" lists every sub-agent 50 at a time; Settings › Usage and Home show one row per paying agent, its sub-agents included.
   - `docs/architecture/invocations.md`, The delegation record and the label paragraph: the delegation card and the spend row name a target by its label, else the first line of its prompt.
   - Bump `Last verified:` and run `mise run fix:markdown`.

## Acceptance criteria

- [ ] A spawn with a label shows the label as its title in the delegation card, the docked panel and the driver's spend row; a spawn without one shows the first line of its prompt.
- [ ] Hovering a sub-agent row in the driver's card shows its full task.
- [ ] Sub-agent rows sit indented under the driver's row, with the Bot icon under the driver's name.
- [ ] With more than five sub-agents in the period, the card shows five and one "N more sub-agents" row, whose amount is the sum of the rest; `spend.breakdown` returns at most five sub-agent ids in `byCallingAgent`.
- [ ] "Show all N sub-agents" lists every sub-agent in the same order as the top five, 50 a page, with "Show 50 more" while some are left; "Show less" goes back to the top five.
- [ ] `spend.subAgents` refuses a `limit` above 50, and returns `{ count: 0, rows: [] }` for an agent that is not a driver.
- [ ] The Invocation reader runs only for the kept ids, or for one page's ids.
- [ ] Settings › Usage and Home show the same rows as before this slice.
- [ ] `mise run check` and `mise run test` pass, and `mise run check:comment-types` passes.

## Smoke test

1. Run `mise run //packages/api-server-api:check`, `mise run //packages/api-server:check`, `mise run //packages/ui:check`, then `mise run //packages/api-server:test` and `mise run //packages/ui:test`.
2. Build and roll out: `mise run cluster:build -- api-server ui`.
3. In the dev app (`http://localhost:4444`), ask a driver agent for seven temporary sub-agents with seven different one-line tasks, six of them with a label and one without, and wait until all seven finish.
4. In the chat, each delegation card shows its label, or the first line of its task for the one without a label.
5. Open the driver's Usage section.
   "Spend by agent" shows "<driver name> (this agent)", then five indented rows with the Bot icon, then "2 more sub-agents".
   Each row's name matches its delegation card, and hovering it shows the full task.
6. Click "Show all 7 sub-agents": the card lists all seven in cost order, with no "Show 50 more"; "Show less" goes back to five and "2 more sub-agents".
7. Call `spend.breakdown` for the driver: `byCallingAgent` has the driver and five sub-agents, and `otherSubAgents.count` is 2.
   Call `spend.subAgents` with `offset: 0, limit: 3`, then `offset: 3, limit: 3`: `count` is 7 both times, the two pages hold six different sub-agents, and their order matches the card's.
   Call it with `limit: 51`: it is refused.
8. Open Settings › Usage and Home: the rows are the same as before this slice.

Then print a short manual guide so the user can repeat steps 3–8 by hand.
