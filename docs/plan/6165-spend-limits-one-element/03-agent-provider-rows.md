# 03 — Agent → Providers rows

**Depends on:** 01-black-meter-and-usage-list
**Part of:** Spend and limits read as one thing — see [README](./README.md)

## Context

On an agent's Providers, a granted provider that takes a limit carries a pill with the agent's spend against its Connection limit.
Like Settings (02), the spend becomes text that opens the limits below the row: the agent's own limit on that provider, then, under a hairline, the provider's limit for all agents.

## Implementation plan

Apply `/react-ui-engineering`.

1. In `packages/ui/src/modules/providers/components/provider-spend-row.tsx`, replace `ProviderSpendBadge` with the same disclosure as slice 02 (spend text and chevron, one `aria-expanded` state), and render the panel under the row in `sandboxes/components/sandbox-providers-section.tsx`'s list item.
   The attach dialog (`sessions/components/attach-providers-dialog.tsx`, `showSpend` false) stays without spend.
2. **Panel**, from `useConnectionSpendLimit` (`spend/components/connection-spend-limit.tsx`):
   - "Limit on the agent" with the agent's avatar (`LevelIcon` with the `LevelAgent`), the black bar, spent over "of limit", a `SpendLimitButton` for `{ kind: "connection", agentId, connectionId }` with `compare`, and "Resets at … your time.".
     Without a limit: the spent amount and "Set a limit".
   - Under a hairline (`border-t border-border`), "{Provider}, all agents" with the provider icon and a small people badge, its bar and spent over "of limit", read only; absent when there is no such limit.
3. Remove what no longer has a caller: `ProviderSpendBadge`, `SpendPill`, `LimitLine`, `also-counted-by.tsx`, `level-list.tsx`, `shared-limit-bar.tsx`, and `copy.ts` strings only they used (`ALSO_COUNTED_BY`, `STOPS_FIRST`, `badgeSpend*`, …).
   Check `rg` before deleting each.
4. **Docs.** `docs/architecture/spend-limits.md` → **Screens**: the agent's Providers bullet (pill → spend text that opens both limits); drop the "Also counted by" pattern paragraph, now gone from every screen.
5. Update any `.quality-inspector/qi-profile-dam/` helper that uses `provider-spend-badge` or `provider-set-limit` on the agent.

## Acceptance criteria

- [ ] An agent's provider row shows the agent's spend there as text with a chevron; opening it shows "Limit on the agent" and "{Provider}, all agents", each with a black bar.
- [ ] Change on the agent's limit opens the existing limit dialog with its comparison line.
- [ ] Long agent or provider names truncate; amounts stay on one line.
- [ ] No dead component or copy string is left; UI checks and tests pass.

## Smoke test

`mise run //packages/ui:check && mise run //packages/ui:test`.
Manually: an agent with Anthropic and Bob; open Anthropic, both limits show with bars; Bob shows Bc.
