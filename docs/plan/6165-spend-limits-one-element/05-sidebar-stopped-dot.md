# 05 — Sidebar stopped dot

**Depends on:** 04-server-stopped-agents
**Part of:** Spend and limits read as one thing — see [README](./README.md)

## Context

An agent that a limit stopped gets a red dot in the sidebar, in the place and size of the blue unread dot, with a label that names the limit and when calls resume.
There is no mark for an agent close to a limit, and a stopped agent with unread messages shows the red dot only.

## Implementation plan

Apply `/react-ui-engineering`.

1. **Query.** `useSpendStopped()` in `packages/ui/src/modules/spend/api/queries.ts`, polling like `useOwnerSpendStatus` (15 s); add `trpc.spend.stopped.queryKey()` wherever `trpc.spend.status.queryKey()` is invalidated (`spend/api/mutations.ts`, `approvals/api/mutations.ts`).
2. **Sidebar wiring.** In `agents/hooks/use-sidebar-agents.ts`, return `stoppedAgents: Map<agentId, SpendStoppedAgent>` beside `unreadAgentIds`; pass `stopped` to `SidebarAgentRow` from `agents/components/sidebar-agents.tsx`.
   Agents the user only edits are not in the answer (the server returns owned agents), so they never get a dot.
3. **Dot.** In `agents/components/sidebar-agent-row.tsx`, where the unread dot renders: when `stopped`, render the same `size-4` box with a `size-2 rounded-full bg-danger` dot, `role="img"` and `aria-label` = the label, wrapped in the product `Tooltip` with the same text; skip the blue dot and its "(unread)" text.
   Keep the hover/selection layout rules the unread dot uses (`HIDDEN_WHEN_REVEALED`, `filtered && "ml-6"`, the `pr-[34px]` padding that checks `unread`).
4. **Label.** `stoppedByLimit(name, left, time)` in `spend/lib/copy.ts`: `Stopped by a limit: {name}. {left} left today, calls stop until {time}.`, with `left = bareSpend(leftMicros, unit)` and `time = localResetTime(resetsAt)`.
   Name by kind: agent → "Limit on the agent", connection → "{agent} on {provider}" as the Usage list names it, owner-connection → "{provider}, all agents", owner → "Total daily limit", ceiling → "Spend ceiling". Reuse `level-labels.ts` names where they match.
5. **Docs.** `docs/architecture/spend-limits.md` → **Screens**: a sidebar bullet.

## Acceptance criteria

- [ ] A stopped agent shows a red dot where the unread dot sits, with "Stopped by a limit: …" as its accessible name and tooltip.
- [ ] A stopped agent with unread messages shows only the red dot.
- [ ] An agent near but under a limit shows no mark.
- [ ] `sidebar-rows.test.ts` covers the stopped dot beside the unread dot (update the existing cases); UI checks and tests pass.

## Smoke test

`mise run //packages/ui:test`.
Manually: hit a $0.01 agent limit, see the red dot within 15 s with the tooltip; raise the limit, the dot goes.
