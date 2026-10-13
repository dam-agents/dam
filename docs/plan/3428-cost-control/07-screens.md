# 07 — Screens

**Depends on:** 04-agent-limit-and-refusal, 05-ceiling-and-provider-limits
**Part of:** Cost control — see [README](./README.md)

## Context

This slice brings spend limits to the screens (D9).
The owner sets limits where the work happens: the agent page, the agent's Providers section, and Settings.
Each limit shows the metered spend next to it, and the meter changes colour at 80% and at 100%.
The Home spend widget and the agent's spend summary use the metered number.
The `spend_limit` approval gets its own card text with a "Continue" action.
The Usage page keeps its current data: it moves to the metered number in a later issue.

There are no Figma frames.
Petr owns the design.
Use only existing components and tokens.
Do not invent new visual parts or sizes.
Take the sizes from the primitive that you reuse.

## Implementation plan

Apply `/react-ui-engineering`.
Server state comes only from the `spend` tRPC procedures through TanStack Query.
Do not copy it into Zustand or local state.
A limit field is a one-field inline edit, so controlled `useState` is enough (no React Hook Form).

1. **Spend UI module** `packages/ui/src/modules/spend/`:
   - `api/queries.ts`: `useSpendStatus(agentId?)` and `useSpendDaily(...)`;
   - `api/mutations.ts`: `useSetSpendLimit()`, which invalidates the status queries;
   - `lib/`: format micro-units per unit (`$` with 2 decimals for `usd`, "list $" for `usd_list`, Bobcoins with up to 6 decimals).
     Map a limit state to the existing warning and danger tokens.
   - `components/SpendLimitField`: the inline edit of one limit in one unit (view, edit, clear).
     It has three users, so it is one shared component.
   - `components/SpendLimitMeter`: spent, limit and what is left, with the state colour.
     Reuse the bar of `SpendBar` (`modules/metrics/components/spend-bar.tsx`) or `SlotBar` (`modules/budgets/components/compute-usage.tsx`).
     Follow the "$used of $limit" text and the danger colour of `ProviderBalance` (`modules/providers/components/provider-balance.tsx`).
2. **Agent page.**
   - In the Usage section (`modules/metrics/components/sandbox-usage-section.tsx`), add a "Daily spend limit" card at the top.
     It has the agent limit's `SpendLimitField` and `SpendLimitMeter`.
     It shows today's metered spend and the time when the day resets (UTC).
     When the owner's own limit or the ceiling is the nearer one, it says so in one line.
   - The section summary (`modules/sandboxes/hooks/use-section-summaries.ts`) shows today's metered spend and the limit, from `spend.status`.
     Today it shows the agent-reported month total.
3. **Providers section** (`modules/sandboxes/components/sandbox-providers-section.tsx`).
   In each granted Connection card, add a Connection limit with `SpendLimitField` in the Connection's unit, and today's spend on that Connection.
   Hide it for `free` Connections, for `openai` and `bedrock` Connections (not priced in this feature), and for Connections that are not metered.
4. **Settings.**
   In the Usage tab (`modules/metrics/views/usage-view.tsx`, shown by `modules/settings/views/settings-view.tsx`), add a card at the top:
   - the own daily limit with `SpendLimitField` and `SpendLimitMeter`;
   - one line with the operator's ceiling and its state, when a ceiling applies.
     The rest of the Usage page does not change.
5. **Home.**
   `SpendWidget` (`modules/home/components/spend-widget.tsx`) reads `spend.daily` (metered, `usd`) for its periods and its top agents.
   When an own limit is set, it shows today's own-limit meter.
   It no longer returns nothing when the telemetry store is off, because the metered spend does not need it.
6. **Approval card.**
   - `modules/home/lib/approval-copy.ts`: for `spend_limit`, the headline "Reached its spend limit" and a detail line with the agent, the limit and today's amount.
     For example: "$10.00 of $10.00 today.
     Continue adds $10.00 for today."
     The amounts come from the payload.
   - `modules/home/components/feed-approval-card.tsx` and `modules/approvals/hooks/use-approval-actions.ts`: for `spend_limit`, the primary action is "Continue" (allow once), and the menu has only "Stop for today" (dismiss).
     Hide the actions that write egress rules.
   - `modules/home/hooks/use-approval-toasts.tsx` and the banner copy (`approvalsBannerCopy`): use the same texts.
7. **Brand.**
   All copy uses `getBrand()` (`packages/ui/src/brand.ts`) where it names the product.
8. **Docs** (same commit):
   - `docs/architecture/spend-limits.md`: a short "Screens" section (where each limit is set, the 80% colour, the metered number on Home and on the agent).
   - `docs/architecture/home-feed.md`: the feed also shows spend-limit questions, with "Continue" and "Stop for today".
   - Bump `Last verified:`, and run `mise run fix:markdown`.

## Acceptance criteria

- [ ] The agent page shows the agent limit, today's metered spend and what is left.
  Editing the limit saves it, and clearing it removes it.
- [ ] The meter shows the warning colour at 80% or more and the danger colour at 100% or more, in light and dark themes.
- [ ] The Providers section shows a limit field in the Connection's unit for each metered, paid Connection, and none for Curve Bender.
- [ ] Settings › Usage shows the own limit and, when set, the ceiling.
- [ ] Home's spend widget shows the metered spend, also when the telemetry store is off.
- [ ] A spend-limit question shows on Home with "Continue" and "Stop for today".
  "Continue" raises the effective limit, and the card goes away.
- [ ] The layout works at phone width.
- [ ] No new visual primitive, colour or size is added.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

On the dev cluster, with the Browser pane:

1. `mise run cluster:build -- api-server ui`.
   Check that the browser loads the new bundle (`cluster-ops`: a stale UI bundle has three causes).
2. Open an agent page at `http://localhost:4444`.
   Set the daily limit to $0.05 in the Usage section.
   Send prompts until the meter turns to the warning colour, then to the danger colour.
3. On Home, the spend-limit card appears.
   Click "Continue".
   The agent page shows the new effective limit.
4. In the Providers section, set a limit on one Connection.
   In Settings › Usage, set the own limit.
5. Take screenshots of the agent page, the Providers section, Settings › Usage and Home, in light and dark themes and at phone width.
   Show them to Petr for review before the slice is done.

Then print a short guide for Petr, so that he can repeat steps 2 to 4 by hand.
