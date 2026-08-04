# 02 — Extract the month-period plumbing both Usage surfaces share

**Part of:** Sandbox-level usage metrics — see [README](./README.md)

## Context

The sandbox Usage section reuses the global view's month switcher, so the calendar logic behind it
needs one home. `usage-view.tsx` currently owns `monthStart`, `fillMonthDays` and the inline ‹ ›
control. `fillMonthDays` is the subtle part — it zero-fills the server's sparse per-day rows across
the full month and stops at today for the current month — and a second copy would drift.

This slice moves code and changes no behaviour. Settings › Usage must render and behave exactly as
before, which is what makes it independently verifiable.

Apply the **`/react-ui-engineering`** skill.

## Implementation plan

1. **New `packages/ui/src/modules/metrics/lib/month-range.ts`** — move `monthStart`, `pad` and
   `fillMonthDays` out of `usage-view.tsx` verbatim, exporting `monthStart` and `fillMonthDays`
   (`pad` stays module-private). Carry their existing comments across — the "month boundaries are
   computed in the browser's timezone" note and the "browser owns calendar semantics" note both
   explain *why* and must survive the move.

   Add one helper the views share rather than each deriving it:

   ```ts
   /** The `[from, to)` instant range and label for a selected month, plus whether
    *  it is the current one — the shape both Usage surfaces feed to the query. */
   export function monthRange(month: Date): {
     from: string;
     to: string;
     isCurrentMonth: boolean;
   };
   ```

   Keep the timezone string out of it: it is read from `Intl` at the call site, exactly as today.

2. **New `packages/ui/src/modules/metrics/components/month-switcher.tsx`** — the ‹ › control lifted
   from `usage-view.tsx`'s `PageHeader actions`, as
   `MonthSwitcher({ month, isCurrentMonth, onChange })`. Preserve every detail of the current
   markup: `variant="outline" size="icon-sm"`, the `Previous month` / `Next month` `aria-label`s,
   the `ChevronLeft` / `ChevronRight` Carbon icons at `size={16}` with
   `className="text-muted-foreground"`, the `min-w-[120px] text-center text-sm font-medium` label,
   and `disabled` on Next while the current month is selected.

   The month label is formatted with `formatDate(month, { month: "long", year: "numeric" })` from
   `@/lib/format-time` — move that into the component so neither view repeats it.

3. **`packages/ui/src/modules/metrics/views/usage-view.tsx`** — import from the two new modules and
   delete the moved code. The view keeps `useState` for the selected month, its `PageHeader`, its
   `useSpendBreakdown` call and every section below it. Net effect: shorter file, identical render.

## Acceptance criteria

- [ ] `mise run check` and `mise run ui:test` pass.
- [ ] `usage-view.tsx` no longer defines `monthStart`, `pad` or `fillMonthDays`, and no longer
      builds the ‹ › control inline.
- [ ] No behavioural or visual change to Settings › Usage: same month label, same disabled Next on
      the current month, same zero-filled day columns stopping at today.
- [ ] `monthRange` is the only place either surface derives `from` / `to` / `isCurrentMonth`.
- [ ] The comments explaining browser-timezone month boundaries and browser-owned calendar
      semantics moved with the code rather than being dropped.

## Smoke test

1. `mise run check && mise run ui:test` — both green.
2. `git diff --stat` should show `usage-view.tsx` shrinking and two new files, with no other
   production file touched.
3. In the dev server on `localhost:5173`, open Settings › Usage and confirm against the state before
   this slice:
   - the current month's label and figures are identical;
   - Next month is disabled, Previous month steps back and repopulates;
   - the day chart shows one column per day up to today, no empty future columns.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
