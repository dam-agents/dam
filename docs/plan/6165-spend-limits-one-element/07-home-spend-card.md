# 07 — Home API spend card

**Depends on:** 01-black-meter-and-usage-list
**Part of:** Spend and limits read as one thing — see [README](./README.md)

## Context

After handoff the operator asked for limits on Home after all: on the Today tab, each of the top three agents shows its own daily limit, and below a hairline each provider with a limit for all agents gets a row.
Every bar sits on one scale, the largest spend or limit shown, so spends still compare at a glance: a limit is a grey track of its length, the spend a black fill.
This month and Last month keep the same rows without limits, because limits are daily.

## Implementation plan

Apply `/react-ui-engineering`.

1. In `packages/ui/src/modules/spend/components/top-spenders.tsx`, on Today only, read each shown agent's own limit (`useQueries` over `trpc.spend.status` with `{ agentId }`, `agentLimitOf` in `spend/lib/agent-limit.ts`) and the owner's Connection limits for all agents (`useOwnerSpendStatus`, `scope.kind === "owner-connection"`, names via `useAppConnections` and `connectionDisplayName`).
2. One scale: the largest of every shown spend and every shown limit's amount.
3. A row: icon (agent avatar, or provider mark), name (`w-[34%] truncate`), the bar (`flex-1`: a `bg-foreground/10` track as wide as the limit, a `bg-foreground` fill as wide as the spend; no track without a limit; the subscription value as today's light extra fill), and the amount as "$x" over "of $y" (`LimitAmounts`), or "$x" alone.
4. The card keeps one height on every tab: the sizer reserves the provider rows too.
5. **Docs.** `docs/architecture/spend-limits.md` → **Screens** → Home: limits on Today.

## Acceptance criteria

- [ ] Today: an agent with a limit shows "$x" over "of $y" and a grey track of the limit's length; one without shows a fill only.
- [ ] Today: each provider limit for all agents has a row below a hairline.
- [ ] Every bar on the card uses one scale.
- [ ] This month and Last month show no limits and no provider rows, and the card does not change height between tabs.
- [ ] UI checks and tests pass.

## Smoke test

`mise run //packages/ui:test`; manually, Home with an agent limit and a provider limit for all agents, on each tab.
