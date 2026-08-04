# 04 — Sandbox Usage section, reachable from the sandbox nav

**Depends on:** 01-scope-breakdown-to-one-agent, 02-share-month-period-plumbing,
03-fix-usage-query-states
**Part of:** Sandbox-level usage metrics — see [README](./README.md)

## Context

The user-visible slice: a **Usage** entry in the Configure Sandbox nav that shows the selected
sandbox's spend for one month — four headline stats above the per-model table and per-day chart,
both reused unchanged from the global view.

Apply the **`/react-ui-engineering`** skill.

## Implementation plan

1. **`packages/ui/src/modules/metrics/api/queries.ts`** — give `useSpendBreakdown` an optional
   agent id rather than adding a near-duplicate hook:

   ```ts
   export function useSpendBreakdown(
     from: string,
     to: string,
     timeZone: string,
     agentId?: string,
   ) {
     return useQuery({
       ...trpc.metrics.spendBreakdown.queryOptions({ from, to, timeZone, ...(agentId ? { agentId } : {}) }),
       staleTime: 60_000,
       retry: false,
     });
   }
   ```

   Spreading `agentId` conditionally keeps the global view's query **key** byte-identical to today's,
   so its cache entry doesn't churn. Update the doc comment: the read covers all the user's agents,
   or one when narrowed.

2. **New `packages/ui/src/modules/metrics/components/spend-stat-cards.tsx`** — the four headline
   stats as a responsive row of `Card`s. Props are the already-summed primitives, not the raw
   rollup, so the component does no arithmetic:

   ```tsx
   interface Props {
     costUsd: number;
     calls: number;
     tokensIn: number;
     tokensOut: number;
     durationMs: number;
   }
   ```

   Each card: a `SectionLabel`-weight caption and a `font-mono … tabular-nums` figure. Format with
   the existing `../lib/format.js` helpers — `formatUsdCents` for cost (always two decimals, so it
   never reads as a bare `$0` beside precise amounts), `formatTokens` for both token figures,
   `formatDurationMs` for model time. Render API calls with `toLocaleString()`.

   Labels, matching `SessionStats` in `metrics-panel.tsx` so the same quantities read the same
   everywhere: **Total cost**, **API calls**, **Tokens in / out**, **Model time**. Show tokens as
   `in / out` in one card, the out figure in `text-muted-foreground` to subordinate it, as the
   prototype does.

   Grid: `grid grid-cols-2 gap-3 lg:grid-cols-4` — the sandbox content column is narrower than the
   settings page, so four abreast only at `lg`.

3. **New `packages/ui/src/modules/metrics/components/sandbox-usage-section.tsx`** — the section
   itself, taking `{ agentId }`. It owns the selected-month `useState`, derives the range via
   `monthRange`, and calls `useSpendBreakdown(from, to, timeZone, agentId)`.

   Structure, mirroring the sibling sandbox sections (`SandboxArtifactsSection` is the reference for
   `<section>` + `SectionLabel spaced` + intro copy):

   - Header row: `SectionLabel spaced` "Usage" with `MonthSwitcher` on the trailing edge.
   - One line of muted intro copy stating the scope — this sandbox's LLM spend, including work it
     delegated through Invocations. Keep it to one sentence.
   - Unavailable → the sticky verdict slice 03 introduced, replacing the section body and its month
     switcher. Reuse that mechanism; do not re-derive it from `isError` per month.
   - `isPending` → a skeleton shaped at the final heights, same technique as `UsageSkeleton`. With
     slice 03's `keepPreviousData` in place this is the genuine first load only; a month change dims
     the existing figures instead.
   - `data.byModel.length === 0` → an empty-month `Card`: "No LLM calls in {monthLabel}." Do not
     render zeroed stat cards or an all-zero chart.
   - Otherwise → `SpendStatCards`, then Spend by model in a `Card className="p-0"` wrapping
     `ModelSpendTable`, then Spend by day in a `Card className="p-5"` wrapping `SpendByDayChart`
     with `fillMonthDays(month, isCurrentMonth, data.byDay)`.

   Sum `byModel` once for the stat props; fold `cacheReadTokens + cacheCreationTokens` into tokens-in
   exactly as `ModelSpendTable` does. Ignore `data.byAgent` — scoped to one agent it is a single row
   restating the total.

   Keep the file inside the JSX budget: if the loading/error/empty branches push the render block
   past ~60 lines, extract them as sibling components in the same file, the way `usage-view.tsx`
   keeps `UsageSkeleton` local.

4. **`packages/ui/src/modules/platform/lib/routes.ts`** — add `"usage"` to `sandboxSectionSchema`.
   The route regex is generated from the enum, so `/sandboxes/<id>/usage` starts parsing with no
   further change. Put it **last**, after `artifacts`, matching the prototype's nav order.

5. **`packages/ui/src/modules/sandboxes/components/sandbox-section-nav.tsx`** — append
   `{ section: "usage", title: "Usage" }` to `SECTIONS`.

6. **`packages/ui/src/modules/sandboxes/views/sandbox-home-view.tsx`** — add the branch:
   `section === "usage" ? <SandboxUsageSection agentId={agent.id} /> : …`. The existing chain is a
   nested ternary ending in `ConnectionsSection` as the fallback; insert Usage before that fallback
   so Connections stays the default.

## Acceptance criteria

- [ ] `mise run check` and `mise run ui:test` pass.
- [ ] Configure Sandbox shows a **Usage** entry last in the nav; selecting it renders the section and
      the URL becomes `/sandboxes/<id>/usage`.
- [ ] Reloading that URL directly lands on the Usage section — the route parses, no fallback to
      Connections.
- [ ] Four stats render; **Total cost** equals the sum of the model table's Cost column, and
      **API calls** equals the sum of its per-model call counts.
- [ ] Figures are strictly this sandbox's: the total is ≤ the global Settings › Usage total for the
      same month, and matches this sandbox's bar there in Spend by agent.
- [ ] A sandbox with no LLM calls in the month shows the empty-month message — not zeroed stat cards,
      not an all-zero chart, not an error.
- [ ] With the metrics backend disabled, the section shows the *unavailable on this deployment*
      message, the same as the global view, once and without a skeleton flash.
- [ ] The month switcher steps back and forward, with Next disabled on the current month, and a change
      dims the existing figures rather than replacing them with a skeleton.
- [ ] Settings › Usage is unchanged, and its query key did not change (its cache entry is shared with
      nothing new).

## Smoke test

1. `mise run check && mise run ui:test` — both green.
2. In the dev server on `localhost:5173`:
   - open a sandbox that has run at least one turn → Configure Sandbox → **Usage**;
   - check Total cost against the model table's Cost column, and API calls against its rows;
   - hard-reload `/sandboxes/<id>/usage` and confirm it lands on Usage;
   - step the month back and forward;
   - open Usage on a freshly created sandbox and confirm the empty-month message;
   - open Settings › Usage for the same month and confirm the sandbox's figure is a subset of the
     global total and matches its Spend by agent bar.
3. Confirm the global view's query key is untouched:
   `grep -n "spendBreakdown.queryOptions" packages/ui/src/modules/metrics/api/queries.ts` — the
   `agentId` property must be spread conditionally, absent from the object when not narrowed.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
