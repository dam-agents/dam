# 03 — Usage pages on measured spend

**Depends on:** 01-measuring-start-and-grouped-read, 02-home-card
**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

Settings › Usage and the agent's Usage section read the agents' own reports today (`metrics.spendBreakdown`, telemetry).
Without the telemetry store they show "Agent spend reports are not collected on this deployment", while Home shows spend for the same agents.
This slice moves both pages to measured spend (`spend.breakdown`), with the Toggl-like picker, the notice, and the line "View the earlier estimates", which opens the old reported view, unchanged (decisions 1–5, 7).
It is the last screen slice: after it, slices 01–03 can ship alone if the release date comes first.
Spend by session type and Model time come in slice 06, because they need the session stamp.

## Implementation plan

Apply `/react-ui-engineering`.
Match the prototype's Settings › Usage artboard; the texts are in [README — Wording](./README.md#wording).
Build the measured parts in `packages/ui/src/modules/spend/`, and leave the telemetry components in `modules/metrics/` working as they are, because the earlier-estimates view still uses them.

1. **The picker** in a new `packages/ui/src/modules/spend/components/period-picker.tsx`.
   There is no date picker in the app; build it from the `Popover` primitive (`components/ui/popover.tsx`) and buttons, with no new dependency.
   - A range button (label: the range; aria "Choose dates") between two arrow buttons ("Previous period", "Next period") that call `stepPeriod` from slice 02.
     "Next period" is disabled when the next period starts after today.
   - The popover: the six presets on the left, and a month calendar on the right with its own month arrows, the weekday heads Mon … Sun, and an ISO week number column ("W42").
   - The first click on a day starts a custom range, and the second click ends it; "Done" closes the popover.
   - Days before T are struck out with the tooltip "Not measured yet"; days after today are disabled; days more than 365 days from the first pick are disabled with the tooltip "Choose at most 366 days".
   - The footer text "UTC days.
     Weeks start on Monday."
   - Use real `<button>` elements with `aria-label`s; arrow keys are not required.
2. **The measured body** in a new `packages/ui/src/modules/spend/components/measured-usage.tsx`, `MeasuredUsage({ agentId?, period, onPeriodChange })`:
   - The row: `PeriodPicker` and the checkbox "Show use covered by plans" (`useShowPlanUse` from slice 02).
   - The main card: the label "API spend", the big `usd` total, the range line, the plan, near-zero and Bob lines (share the Home card's line components from slice 02).
   - The stat cards "API calls" and "Tokens in / out" from `totals`; reuse `SpendStatCards` (`modules/metrics/components/spend-stat-cards.tsx`) only if it takes these values without its telemetry fields, else build a small measured variant with the same primitives.
     Do not repeat the total as a stat card.
   - The estimated note when `estimatedCalls` is above zero.
   - "Spend by day": reuse `SpendByDayChart` (`modules/metrics/components/spend-by-day-chart.tsx`); give its columns an optional plan part in the lighter neutral token, so the earlier view renders as before.
     Fill every day of the range; above 62 days, show one column per ISO week.
     A day before T has no bar and the tooltip "‹day›: not measured".
   - "Spend by agent" (only without `agentId`), "Spend by model", "Spend by provider": rows with `SpendBar` and the row texts of the Wording table.
     Label an agent with its live name from the app's agent list, else its id; label a Connection with `connectionName`, else its id.
     Under Spend by provider, add the caller's model-provider Connections whose template is not metered (`connectionLimitRule(...).reason === "not_metered"`, from the existing providers query) as "Not priced" rows, and show a `usd` row of an `openai` or `bedrock` Connection at $0 as "Not priced".
   - Empty card text "No API spend in this period."
3. **Settings › Usage** `packages/ui/src/modules/metrics/views/usage-view.tsx`:
   - Keep `PageHeader` with its title and description, without the month switcher in its actions.
   - Under it: `MeteringNotice` (slice 02) with the link "View the earlier estimates" / "Hide the earlier estimates" when `spend.metering` gives `earlierEstimatesUntil` and now is before it.
   - The earlier-estimates section, closed by default: the heading and text of the Wording table, then the current telemetry view unchanged (`MonthSwitcher`, `UsageStaleLabel`, the total and the "Spend by …" sections), moved into a component such as `EarlierEstimates` in `modules/metrics/views/`.
     Remove `HarnessReportsLead` from it; the section text replaces it.
   - Then `MeasuredUsage` with the period from the route (`route.period`, default `this-month`); a period change replaces the URL (`history.replaceState`), so the back button does not step through every click.
   - Then the "Spend limits" section with `OwnSpendLimitCard`, as in the prototype.
   - Remove `MeasuredSpend` (the `SpendWidget` at the top) and the "unavailable" branch: the page no longer depends on the telemetry store.
4. **The agent Usage section** `packages/ui/src/modules/metrics/components/sandbox-usage-section.tsx`:
   - Keep `AgentSpendLimitCard` at the top.
   - Then `MeasuredUsage agentId={agentId}` with the period in local state (default `this-month`).
   - Remove `HarnessReportsLead`, the `MonthSwitcher`, `UsageStaleLabel` and the telemetry stat cards and sections from this section.
     Keep `HarnessSpendCard` until slice 06.
   - On a sub-agent's page (`useRootDriver` finds a root driver), keep only `RootDriverSpendNote` as today; slice 06 adds the sub-agent's own calls.
   - No notice and no earlier estimates on this section.
   - Update the nav description in `modules/sandboxes/components/sandbox-section-nav.tsx` only if it names reports.
5. **Clean-up of unused code:** remove UI code that nothing uses after this slice (for example `usage-notice.tsx` parts or `use-monthly-spend.ts` paths), but keep everything that the earlier-estimates view uses.
6. **Docs.**
   - `docs/architecture/spend-limits.md` § Screens: the Settings bullet (the picker, the measured cards, the notice and the earlier estimates) and the agent page bullet; remove the last line "The rest of the Usage pages still shows the spend that the harnesses report".
   - `docs/architecture/metrics.md` § Overview and § Disabled backend: the Usage surfaces read Metered Spend; the telemetry spend read serves the earlier-estimates view for 30 days after T, and the sidebar until slice 06.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/ui:test` pass.
- [ ] Settings › Usage shows measured spend with the telemetry store off, and no "not collected" message.
- [ ] Settings "This month" equals Home "This month"; the agent section's total for an agent equals that agent's row under Spend by agent.
- [ ] Every preset, both arrows and a custom range work; the URL holds the period after a reload; days before T are struck out.
- [ ] A range above 62 days shows weekly columns.
- [ ] "Not priced" and "No cost" rows follow the units table.
- [ ] With the telemetry store on, "View the earlier estimates" opens the old view with its month switcher; with the store off, the line is gone.
- [ ] Slices 01–03 together build and pass `mise run check` without slices 04–08.

## Smoke test

1. Rebuild and deploy the UI and the api-server on the local cluster; open Settings › Usage as `dev`.
2. Click each preset and both arrows; pick a custom range across a month boundary; reload and confirm the URL keeps it.
3. Compare the This month total with Home's card and with `spend_daily` in psql.
4. Open an agent's Usage section; compare its total with its Spend by agent row on Settings.
5. If the telemetry store is on, open and close the earlier estimates; if it is off, confirm the line is missing.
6. Take screenshots of both pages in the light and the dark theme, and of the open picker, for the pull request.

Print a short manual guide for Petr with these steps.
