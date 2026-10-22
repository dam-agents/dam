# 03 — Limit meters: black, thin, one family; Settings › Providers and Usage

**Depends on:** 02-binding
**Part of:** Provider spend limit for all agents — see [README](./README.md)

## Context

The approved design ([`mockup.html`](./mockup.html), sections 1 and 2) replaces the 20 px grey
limit meter with a 12 px black one with its percentage beside it, and puts the all-agents provider limit where providers live:
Settings › Providers sets it, Settings › Usage only summarizes it. Home's memory and CPU pool bars
take the same fill and height so every meter reads as one design. This slice restyles the shared
meter and adds those two surfaces; the agent's Providers view is 04.

## Implementation plan

Apply **/react-ui-engineering**.

1. **Colours** — `packages/ui/src/modules/spend/lib/state-colors.ts`: `LIMIT_STATE_FILL.ok` becomes
   `bg-foreground` (black, white in dark mode); add `LIMIT_STATE_TRACK` — `ok`: a light tint of
   foreground (`bg-foreground/10`), `warn`: `bg-warning/15`, `reached`: `bg-danger/15`.
   `packages/ui/src/modules/budgets/lib/pool-colors.ts`: `NEUTRAL_FILL` and `LEVEL_FILL.ok` become
   `bg-foreground`; `REST_FILL`/`NEUTRAL_LIGHT_FILL` a lighter foreground tint. Keep the
   `UNIT_BOUNDARY_DESCRIPTION` comments true ("the spend bars and the resource bars read as one
   design"). Check the spend-by-day chart and top-spender bars that import these still read well;
   they are not limit meters, so if black is too heavy there, give them their own constant
   rather than keeping grey in the shared one.
2. **Meter** — `components/daily-limit-meter.tsx`: "‹spent› of ‹limit› today" on the line above
   the bar (drop the "‹x› left" part of `spentOfLimit` in `lib/copy.ts`); below it a row with the
   bar — `SpendBarTrack` at `h-3 rounded-sm` on `LIMIT_STATE_TRACK` — and, to its right, the
   percentage of the limit (`text-xs tabular-nums`, muted when ok, `LIMIT_STATE_TEXT` otherwise,
   `min-w-9 text-right`); the bar's `aria-label` keeps the amounts. The state line stays below.
   `metrics/components/spend-bar.tsx` `SpendBarTrack`: take a `trackClassName` instead of the fixed
   `h-5 bg-muted`; its other callers pass the old classes so they don't change.
3. **Home pool bars** — `budgets/components/pool-bar.tsx`: `h-3` stays (12 px), now black on the
   tint from step 1.
4. **Settings › Providers** — `providers/components/provider-section.tsx` / `provider-row.tsx`:
   for a connected provider whose `connectionLimitRule(templateId).limitable`, render a new
   `spend/components/all-agents-provider-limit.tsx` under the row: title "Daily limit for all
   agents" + help tip, `SpendLimitButton` with scope `{ kind: "owner-connection", connectionId }`
   and the rule's unit, the meter on `status.ownerSpentByConnection` and the limit from
   `useOwnerSpendStatus()`, the reset line only when a limit is set. A non-limitable provider gets
   the existing `NO_LIMIT_REASONS` line. Today the whole row is one `CardButton`; make only the top
   part the button so the limit button is not nested inside it (keep its `aria-label`). Hide the
   block in the attach dialog (`provider-settings-modal.tsx` passes `onConnected`) — it belongs to
   Settings only.
5. **Settings › Usage** — `spend/components/own-spend-limit-card.tsx`: under the main meter, when the
   owner has at least one `owner-connection` limit, a divided block "Provider limits for all agents"
   with a help tip and a right-aligned link "Edit in Providers" (`navigateToSettings("providers")`),
   then a 3-column grid per limit: Connection name, a 4 px (`h-1`) bar in its state colour, and
   its percentage (state colour). "‹spent› of ‹limit› today" is the bar's tooltip. No buttons.
   Hidden when there are none.
6. **Copy** — `spend/lib/copy.ts`: `OWN_LIMIT_HELP` drops "Subscriptions and Bob do not count: set
   those limits in each agent's Providers section" → points to Settings › Providers;
   `connectionLimitHelp` drops "Only this limit stops calls on this provider"; add
   `ALL_AGENTS_PROVIDER_LIMIT_TITLE`, its help and the summary texts.
7. **Docs** — `docs/architecture/spend-limits.md` **Screens**: Settings › Providers, the Usage
   summary, the meter's look. `/doc-drift`.

## Acceptance criteria

- [ ] Every limit meter is 12 px with its percentage to the right, black on a light tint when fine,
      orange at 80 %, red when reached, in light and dark mode; no grey and no blue fill remains on
      a limit meter, and no "‹x› left" figure beside it.
- [ ] Home's memory and CPU bars are 12 px and black on the same tint.
- [ ] Settings › Providers shows "Daily limit for all agents" under each connected limitable
      provider; setting, changing and removing it works; free/unpriced providers show the reason.
- [ ] Clicking the provider row's top part still opens its edit dialog; the limit button opens
      only the limit dialog.
- [ ] Settings › Usage shows the read-only summary only when a provider limit exists.
- [ ] `mise run check` and `mise run test` pass (update existing UI unit tests whose snapshots
      or class assertions name the old fills).

## Smoke test

`mise run check` and `mise run test`.

Then `mise run cluster:install` (or rebuild the UI on a running cluster) and, in the browser:
Settings › Providers → Anthropic → "Set a limit" $20 → the meter appears; Settings › Usage shows the
Anthropic summary bar; Home's memory bar is black and 12 px; toggle dark mode
and check all three.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
