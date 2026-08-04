# 05 — Live month-to-date figure on the Usage nav line

**Depends on:** 04-sandbox-usage-section
**Part of:** Sandbox-level usage metrics — see [README](./README.md)

## Context

Every other entry in the Configure Sandbox nav carries a live one-line summary — "GitHub", "No
schedules", "3 artifacts · 1 shared". After slice 03 the Usage entry is the only one showing the
nav's neutral `—` placeholder. This slice gives it the sandbox's month-to-date spend, so the number
is visible without opening the section.

The prototype shows a static "Cost & token usage" here; a live figure was chosen instead because it
keeps the nav's established contract of summarising rather than describing.

Apply the **`/react-ui-engineering`** skill.

## Implementation plan

1. **`packages/ui/src/modules/sandboxes/hooks/use-section-summaries.ts`** — add the current-month
   spend to the hook that already assembles every other section's line.

   Derive the range with `monthRange(monthStart(new Date(), 0))` from
   `../../metrics/lib/month-range.js` and read the timezone from `Intl` — the **same inputs** slice
   03's section computes for the current month, so both resolve to one TanStack cache entry and the
   nav costs nothing while the user is on the Usage section.

   ```ts
   const { from, to } = monthRange(monthStart(new Date(), 0));
   const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
   const { data: spend } = useSpendBreakdown(from, to, timeZone, agent?.id);
   ```

   `useSpendBreakdown` takes a bare `agentId?: string`, so it cannot be disabled via `skipToken`
   while no agent is selected. Guard the call so an agentless render doesn't fire an all-agents read
   — the wrong scope *and* a wasted aggregate. Either add `skipToken` support to the hook (matching
   `useSessionCosts` and `useMetricsOverview`, which both already use it) or gate on `agent` before
   deriving the inputs. Prefer extending the hook: the other two metrics hooks establish the pattern,
   and a hook that fires the wrong query when under-specified is a trap for the next caller.

   Then the summary:

   ```ts
   const usageSummary = useMemo(() => {
     if (!agent || !spend) return undefined;
     const total = spend.byModel.reduce((sum, row) => sum + row.costUsd, 0);
     return total > 0 ? `${formatUsdCents(total)} this month` : "No spend this month";
   }, [agent, spend]);
   ```

   Return it as `usage` in the hook's result object. `formatUsdCents` comes from
   `../../metrics/lib/format.js` — always two decimals, so the nav never shows a bare `$0` next to
   precise figures.

2. **Failure behaviour — verify, don't add code.** On a deployment without the telemetry store the
   read throws `PRECONDITION_FAILED`, `data` stays `undefined`, the summary stays `undefined`, and
   `SectionNavItem` already renders `—`. Confirm that rather than adding an error branch: a missing
   line is the correct degradation, so this summary deliberately ignores `isError`.

   Slice 03 made that verdict sticky and stops querying once it is known, so the nav costs at most one
   doomed request per session — check it doesn't reintroduce a per-render one.

## Acceptance criteria

- [ ] `mise run check` and `mise run ui:test` pass.
- [ ] The Usage nav line shows `$N.NN this month` for a sandbox with spend in the current month.
- [ ] It shows "No spend this month" for a sandbox with none — not `$0.00 this month`, not `—`.
- [ ] The figure equals the Usage section's **Total cost** stat for the current month.
- [ ] Opening the Usage section fires **no additional** request: the nav's query and the section's
      current-month query share one cache entry (identical `from` / `to` / `timeZone` / `agentId`).
- [ ] With the metrics backend disabled the line falls back to `—`, and the rest of the nav's
      summaries still render.
- [ ] No spend query is issued while no sandbox is selected.

## Smoke test

1. `mise run check && mise run ui:test` — both green.
2. In the dev server on `localhost:5173`, open a sandbox with recent spend and, with the Network tab
   filtered to `spendBreakdown`:
   - land on Sandbox Setup → exactly one `spendBreakdown` request, and the Usage nav line shows the
     figure;
   - click Usage → **no new** `spendBreakdown` request (served from cache), and the section's Total
     cost matches the nav line;
   - step the month back inside the section → one new request, and the nav line does **not** change
     (it is pinned to the current month).
3. Open a freshly created sandbox → the line reads "No spend this month".

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
