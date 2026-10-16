# 02 — Home card

**Depends on:** 01-measuring-start-and-grouped-read
**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

Home's "API spend" card reads measured spend since #3428, but it changed in place: rolling periods, no start date, and no word on what it counts.
This slice gives it the calendar periods Today · This month · Last month, the real range under the total, the paid total with plan use behind a checkbox, the near-zero and Bob lines, the notice about T, and "View details" with the period (decisions 3, 4, 5, 7).
It also builds the shared pieces that slice 03 reuses: period math, range labels, the plan-use preference, the notice and the copy.

## Implementation plan

Apply `/react-ui-engineering`.
Server state comes only from the `spend` procedures through TanStack Query; do not copy it into local state.
Match the prototype's Home artboard; the texts are in [README — Wording](./README.md#wording).

1. **Queries** in `packages/ui/src/modules/spend/api/queries.ts`:
   - `useSpendBreakdown({ agentId?, from, to })` on `trpc.spend.breakdown`, with `placeholderData: keepPreviousData` and the 30 s refetch of `useSpendDaily`.
   - `useSpendMetering()` on `trpc.spend.metering`, with a long `staleTime` (T never changes).
2. **Periods** in `packages/ui/src/modules/spend/lib/spend-period.ts`: replace `1d | 1w | 1m | 1y` with the period ids of [README — Periods](./README.md#periods).
   Write pure functions that slice 03 reuses: `rangeOf(period, today)`, `stepPeriod(period, ±1)` (same kind; a custom range by its own length), `parsePeriod(text)` and `formatPeriod(period)` for the URL, all on UTC days.
   Home uses `today`, `this-month` (default) and `last-month`.
   Remove `useSpendDaily` when nothing in the UI uses it after this change; the `spend.daily` procedure stays for the CLI.
3. **Range labels** in a new `packages/ui/src/modules/spend/lib/range-label.ts`: "4 Nov 2026", "1–31 Oct 2026", "28 Sep – 4 Oct 2026", "28 Dec 2026 – 3 Jan 2027", in UTC.
   `measuredRange(range, startDay)` returns the measured part of a range: the whole range, the range from T, or nothing.
4. **Plan-use preference** in a new `packages/ui/src/modules/spend/lib/plan-use.ts`: `useShowPlanUse()` returns `[on, setOn]`, stored with `readPersistedFlag` / `writePersistedFlag` (`packages/ui/src/lib/persisted-prefs.ts`) under one key, for example `spend.show-plan-use`.
   Off by default.
   Home and the Usage pages share the key, so the choice holds on both.
5. **Notice** in a new `packages/ui/src/modules/spend/components/metering-notice.tsx`: shown when `spend.metering` gives `noticeUntil`, now is before it, and the viewer did not dismiss it.
   Store the dismissal as a persisted flag (for example `spend.metering-notice-dismissed`).
   Reuse the `Callout` primitive (`components/ui/callout.tsx`) with its info tone and an icon button to dismiss, as other banners do; take no new sizes.
   It takes an optional `children` slot, so slice 03 adds the earlier-estimates link.
6. **Copy** in `packages/ui/src/modules/spend/lib/copy.ts`: every Home text of the Wording table, with `getBrand().name`; replace `apiSpendHelp()`.
7. **The card** `packages/ui/src/modules/spend/components/spend-widget.tsx` (`SpendWidget`):
   - The period control: use the `Tabs` primitive (`components/ui/tabs.tsx`, `variant="pill"`, `size="sm"`) as `ResourcesCard` does on Home (`modules/budgets/components/resources-card.tsx`), in place of the hand-made `aria-pressed` group.
   - Read `spend.breakdown` for the period's range (no `agentId`) and `spend.metering`.
   - Big number: the `usd` total (`AnimatedUsd`), or "—" when the whole period is before T.
   - Under it: the range line from `measuredRange`, with the tooltip when the period starts before T.
   - The plan line (checkbox on, `usd_list` total of at least half a cent), the near-zero line (`usd_list` above `usd`, checkbox on or off), and the Bob line with its `HelpTip` (`bobcoin` total above zero; format with the existing `formatSpend` for `bobcoin`).
   - Top agents from `byAgent`: the size of a row is its `usd`, plus its `usd_list` when the checkbox is on; rows below half a cent drop out, as today.
     The bar shows the paid part and, with the checkbox on, the plan part in a lighter existing neutral token next to it; extend `SpendBarTrack` (`modules/metrics/components/spend-bar.tsx`) with an optional second part so the old call sites stay the same.
   - The own-limit meter shows only for Today, as in the prototype.
   - The empty text "No API spend in this period."
     shows only for a measured period.
   - The footer: the checkbox "Show use covered by plans" (`useShowPlanUse`) and the link "View details".
   - `SpendWidget showOwnLimit={false}` at the top of Settings › Usage (`modules/metrics/views/usage-view.tsx`, `MeasuredSpend`) stays until slice 03 replaces it.
8. **"View details" keeps the period.**
   - `packages/ui/src/modules/platform/lib/routes.ts`: the settings route gets an optional `period` for the `usage` tab; `parseRoute` reads `?period=` and `routeToPath` writes it.
   - `packages/ui/src/modules/platform/store/navigation.ts`: `navigateToSettings(tab, options?)` passes the period.
   - The link is a real `<a href>` with the path, and its click handler navigates inside the app, so a new tab also works.
9. **Docs.** `docs/architecture/spend-limits.md` § Screens, the Home bullet: the three calendar periods, the range line, plan use behind the checkbox, the Bob line, the notice until T + 30 days, and "View details".
   Remove "the last 7, 30 or 365 UTC days".

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/ui:test` pass.
- [ ] The card shows Today, This month (selected by default) and Last month, and each period shows its range line in the Wording format.
- [ ] A period that starts before T shows its measured part and the tooltip; a period wholly before T shows "—" and "Not measured.
  Measuring started on ‹T›.".
- [ ] The checkbox changes the bars and the plan line, never the big number, and it stays set after a reload.
- [ ] The near-zero line and the Bob line follow their rules with the checkbox on and off.
- [ ] The notice shows for a user with an agent created before T, and a dismissal survives a reload.
- [ ] "View details" opens `/settings/usage?period=<the card's period>`.
- [ ] The own-limit meter shows only for Today.
- [ ] No text names the brand except through `getBrand()`.

## Smoke test

1. Rebuild and deploy the UI and the api-server on the local cluster (`cluster-ops` skill); open `http://localhost:4444` as `dev`.
2. On Home, switch the three periods; compare "This month" with `select sum(cost_micros) from spend_daily where unit='usd' and day >= date_trunc('month', now())` for the dev owner.
3. Turn the checkbox on and off with an agent on the Claude subscription; reload; the setting holds.
4. Dismiss the notice; reload; it stays hidden.
5. Click "View details"; the URL carries the period (Settings › Usage still shows its old content until slice 03).
6. Take screenshots in the light and the dark theme for the pull request.

Print a short manual guide for Petr with these steps.
