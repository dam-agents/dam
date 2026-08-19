# 05 — Compute and spend widgets

**Depends on:** 01-home-shell-feed
**Part of:** A Home page — see [README](./README.md)

## Context

The first two blocks in Home's right-hand column: live compute with a bar per agent, and spend with a
period toggle. Both read contracts that already exist, so this slice is UI only.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. Compute — `modules/home/components/compute-widget.tsx`

Today's Home already shows aggregate compute: `modules/budgets/components/budget-meter.tsx` renders
reserved-versus-ceiling CPU and memory from `budgets.reserved`. Keep that as the widget's headline —
it is the only place the **ceiling** comes from, since `BudgetReserved` is owner-wide totals with no
per-agent breakdown.

The prototype draws a **row of cells, one per compute unit** — not bars — coloured by state, with a
legend below. It models CPU and Gi as one number, which no real install guarantees: a dev cluster runs
4 cores against 8 Gi. Key the cells on **CPU**, headline `used/ceiling CPU`, and carry memory in the
legend rows and the per-cell tooltip. `AgentView.size` gives each agent's `{ cpu, memory }` quantity
strings; parse them with `parseCpuMilli`/`parseMemoryMi` from `modules/sandboxes/lib/quantity.ts`.

The prototype's *running* vs *awake* split means "has work in flight" vs "pod up but idle". Take the
working set from the feed's in-progress items rather than dialling ACP again, so the page keeps one
fan-out.

Two things to get right:

- **Label it what it is.** These are requests and limits — *allocated* compute, not measured usage.
  The issue is explicit that labelling allocation as usage would make the number a lie. Say
  "allocated".
- **Only running agents hold compute.** A hibernated sandbox reserves nothing, so bars should cover
  running agents; if you show hibernated ones, show them as holding zero rather than as their spec.

Reuse `budget-meter.tsx`'s `Dimension` sub-component and `modules/budgets/lib/format.ts`
(`formatCores`, `formatGi`) rather than writing new formatters. The prototype adds a help tooltip on
this widget (its last commit) — carry that across using `@/components/ui/tooltip`, explaining what
allocated means.

### 2. Spend — `modules/home/components/spend-widget.tsx`

`metrics.spendBreakdown` takes `{ from, to, timeZone }` and an **optional** `agentId`; omitting the
agent gives the owner-wide breakdown, which is how `modules/metrics/views/usage-view.tsx` already
renders "Spend by agent". Use `useSpendBreakdown` from `modules/metrics/api/queries.ts` with no
`agentId`.

The period toggle is 1d / 1w / 1m / 1y. Compute the range from the toggle and pass it as `from`/`to`;
`modules/metrics/lib/month-range.ts` has `monthRange`/`monthStart` to model the shape on, and the time
zone comes from `Intl.DateTimeFormat().resolvedOptions().timeZone` as the existing hooks do.

The toggle selection is UI-local to the widget. This is the **only** period control on Home — do not
let it grow into a page-level range.

`useSpendBreakdown` already handles the metrics backend being absent: it returns `isUnavailable` and
disables itself. Honour that by rendering nothing rather than an error — an install without metrics
must not show a broken widget. Follow `usage-view.tsx` for what "unavailable" looks like.

The prototype's `SpendPreview` shows the **top three spenders** under the total, each with a bar
relative to the largest — take that. Keep the deeper detail out: spend by model and by day already have
a home in the existing usage view. Drop any agent whose cost rounds to `$0.00`, or the row renders as a
hairline bar that reads like a bug.

### 3. The column

Place both widgets in the right-hand column of `home-view.tsx`, in the prototype's order and spacing.
Each widget owns its own query and renders independently — one unavailable widget must not blank the
other, and neither may blank the feed.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] The compute widget shows the owner-wide CPU ceiling as cells, labelled as allocated, with memory in the legend.
- [ ] A hibernated sandbox is not shown as holding compute.
- [ ] The help tooltip explains what allocated means.
- [ ] The spend toggle changes the figures across 1d / 1w / 1m / 1y.
- [ ] With metrics unavailable, the spend widget renders nothing and no error is surfaced.
- [ ] The spend widget shows the top three spenders and no by-model / by-day breakdown.
- [ ] Formatters and the meter sub-component are reused from `modules/budgets`, not duplicated.
- [ ] Home has exactly one period control, inside the spend widget.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`, with two sandboxes (one running, one hibernated):

1. Confirm the compute widget's ceiling matches what the old Home meter showed, and that only the
   running sandbox holds compute.
2. Hover the help affordance and confirm it explains allocation versus usage.
3. Switch the spend toggle through all four periods and confirm the figures change.
4. If your install has no metrics backend, confirm the spend widget is absent rather than broken —
   and note in your report which of the two you exercised.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
