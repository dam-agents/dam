# 02 — Settings → Providers rows

**Depends on:** 01-black-meter-and-usage-list
**Part of:** Spend and limits read as one thing — see [README](./README.md)

## Context

In Settings → Providers a connected provider that takes a limit carries a pill today ("$1.23 / $4.56 today") that opens the limit dialog.
Closed, the row now shows only today's spend across all agents, as plain text beside "Connected".
Opened, it shows the limit for all agents below the row.
The row's own click keeps opening the provider dialog (connect, disconnect), as today.

## Implementation plan

Apply `/react-ui-engineering`.

1. **Disclosure.** In `packages/ui/src/modules/spend/components/all-agents-provider-limit.tsx`, replace `AllAgentsSpendBadge`'s `SpendPill` with a disclosure: a button showing the spend as `text-sm tabular-nums text-foreground` (`bareSpend(spent, unit)`, so Bob shows "50.00 Bc") and a chevron on the right; both toggle the same `aria-expanded` state (the spend text and the chevron are one button, or two buttons controlling one panel).
   The open panel is rendered by the row's Card below `ProviderRow`: give `ProviderRow` (`providers/components/provider-row.tsx`) a `panel?: ReactNode` (or render it from `provider-section.tsx` under the row inside the same `Card`) so it sits inside the card, under a hairline.
   Keep the raised layering the row uses so the disclosure does not trigger the row's `onOpen`.
2. **Open panel.** "Limit for all agents" with the people icon (the `LevelIcon` all-connection look), a size-`md` black `LimitBar` filling the row, "$<spent>" over "of $<limit>", a `SpendLimitButton` (Change / Set a limit) for scope `{ kind: "owner-connection", connectionId }`, and "Resets at {localResetTime(status.resetsAt)} your time." in `text-muted-foreground`.
   Without a limit: the spent amount and "Set a limit", no bar.
   Reuse slice 01's `LimitRow` parts where they fit; the Change button sits at the row's end.
3. Providers that take no limit show neither text nor chevron, as today with the pill.
   The `ProviderSettingsModal` (onboarding picker, `onConnected` set) still shows no spend.
4. **Docs.** `docs/architecture/spend-limits.md` → **Screens** → Settings, Providers tab: the pill becomes the spend as text that opens the limit below the row.
5. Check `.quality-inspector/qi-profile-dam/` for a journey or helper that clicks `provider-spend-badge` in Settings and update it.

## Acceptance criteria

- [ ] A closed connected provider row shows today's spend as plain text and a chevron, with no bar and no pill.
- [ ] Opening it shows "Limit for all agents", a black bar filling its row, spent over "of limit", Change and "Resets at … your time."
- [ ] Clicking the row elsewhere still opens the provider dialog.
- [ ] Bob shows amounts in Bc.
- [ ] The UI checks and tests pass, with provider-row tests updated (`provider-several-connections`, `curve-bender-provider-rows`, `provider-key-recheck`, `provider-delete-confirmation` where they touch the pill).

## Smoke test

`mise run //packages/ui:test`.
Manually: Settings → Providers with an Anthropic limit for all agents; the row reads "$x.xx · Connected", the chevron opens the limit, Change opens the limit dialog, clicking the provider name opens the provider dialog.
