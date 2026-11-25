# 01 — One black meter and the limit row; agent Usage lists every limit

**Part of:** Spend and limits read as one thing — see [README](./README.md)

## Context

Every limit meter goes black on grey, at every level, and fills its row.
This slice also introduces the shared limit row (icon, name, bar, spent over "of limit") and uses it on the agent's Usage card, where every other limit that counts the agent is now always listed, replacing the folding "Also counted by" line.

## Implementation plan

Apply `/react-ui-engineering`.

1. **Meter colour.** In `packages/ui/src/modules/spend/components/limit-bar.tsx`, drop the `state` styling: track `bg-foreground/10`, fill `bg-foreground` (the `NEUTRAL_FILL` that `LIMIT_STATE_FILL.ok` already uses), percent text `text-muted-foreground`.
   Keep the `state` prop only if a caller still needs it for something other than colour; otherwise remove it and its callers' arguments.
   Do the same in `shared-limit-bar.tsx` (used by `limit-line.tsx` and `level-list.tsx`): no warning or danger fills or shares.
   In `daily-limit-meter.tsx` the state line stays (it says "close to"/"reached" in words), but in `text-muted-foreground`, not `LIMIT_STATE_TEXT`.
   Remove whatever in `spend/lib/state-colors.ts` has no caller left; keep what Home or other non-meter places still use.
2. **Limit row.** New `spend/components/limit-row.tsx`: `LimitRow({ level, agent, label? })` rendering `LevelIcon`, the name (`w-[34%] min-w-0 truncate text-[13px]`), a size-`md` `LimitBar` with `className="flex-1"` (no percent), and the amount as two lines (`text-sm tabular-nums whitespace-nowrap text-foreground`: `bareSpend(spent, unit)` over `text-xs text-muted-foreground` "of {bareSpend(amount, unit)}").
   The bar's `aria-label` is `"{name}: {pct}% used"`.
   A `LimitRowList` wraps rows in a `<ul>` with an `id` prop so slice 06 can scroll to it (`id="agent-limits"`).
3. **Agent Usage.** In `agent-spend-limit-card.tsx`, replace `<AlsoCountedBy … grouped />` with, below a `border-t border-border pt-3`, `<LimitRowList id="agent-limits">` of `view.others` — no toggle, no "Also counted by" header, no "stops first" mark, no "set in" link.
   Order: the total daily limit first (Σ), then each provider's limit for all agents, then the agent's own Connection limits, then the ceiling when the operator set one (`agentLevels` in `spend/lib/limit-levels.ts` already builds these; reorder there if needed).
   With no agent limit, the card's own block keeps today's no-limit state; the list shows only limits that exist and is absent when there are none.
   Bobcoins: keep the existing "50 Bobcoins today, not in this total" line (`OtherSpendLine`).
4. **Leftovers.** If `also-counted-by.tsx` and `level-list.tsx` have no caller left after 01–03, delete them in slice 03, not here (`limit-line.tsx` still uses `LevelList` until then).
5. **Docs.** `docs/architecture/spend-limits.md` → **Screens**: the meter paragraph ("takes the warning colour at 80%…") becomes "black on a light tint at every level"; the agent's Usage bullet lists the other limits always, as rows.

## Acceptance criteria

- [ ] No meter on the agent's Usage, the Settings Usage card or a provider limit uses a warning or danger class, at 92% or at 100%.
- [ ] The agent's Usage shows every other limit that counts the agent under its own limit, with no button to fold it.
- [ ] Each listed row has the icon, a truncating name, a bar that fills the rest of the row, and spent over "of limit" on one line each.
- [ ] Home's spend card renders as on `main` (no diff in `spend-widget.tsx`, `top-spenders.tsx`).
- [ ] `mise run //packages/ui:check`, `:check:format`, `:check:lint`, `//:check:comment-types` and `//packages/ui:test` pass; tests asserting `LIMIT_STATE_*` classes on these meters are updated.

## Smoke test

`mise run //packages/ui:test` and `mise run //packages/ui:check`.
Manually, on the local cluster: an agent with a limit at ~90% shows a black bar on its Usage, and the total daily limit and "Anthropic, all agents" listed below it without a toggle.
