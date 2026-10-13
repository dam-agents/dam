# 04 — UI: each bar names its fix

**Depends on:** 03-ui-pool-bars
**Part of:** Resource bars — see [README](./README.md)

## Context

A bar at warning or critical should offer the fix right there, so the user frees room in one step.

## Implementation plan

Apply `/react-ui-engineering`.

1. `budgets/lib/pools.ts`, with tests: `idleVmAgents` (running, not working per `useFeed().workingAgentIds`, not stopping or pausing, by memory) and `largestVmAgents` (by allocated storage).
2. New `components/memory-fixes.tsx`, shown at memory warning or critical and when CPU is slowed: the top idle agents with a one-click Pause (`useSuspendAgent().pause`), Stop with confirmation for never-hibernate agents (`useSandboxRowActions`, as in `power-menu-items.tsx`), "Pause all N idle agents (frees about X GiB)", and `RequestMoreLink`; at critical, "At 90% the platform starts pausing idle agents for you."
3. New `components/storage-fixes.tsx`, shown at storage warning or critical: the largest agents, hibernated ones included, each with a confirmed delete; "Clear caches inside your agents" as guidance; `RequestMoreLink`; at critical, "New agents can't be created until storage is under 90%."
4. #4757's storage-full dialog already sends the user to Home, where these fixes show; it needs no change.
5. Docs: one sentence in the "Freeing room" section of `budgets.md`.

## Acceptance criteria

- [ ] At 75% memory or more, idle agents are listed largest first, and one click pauses one or all of them.
- [ ] At 75% storage or more, the largest agents are listed, and delete asks for confirmation.
- [ ] No fix shows at `ok`.

## Smoke test

`mise run //packages/ui:check`, `mise run //packages/ui:test`; agent-browser screenshots of the memory fixes before and after "Pause all" and of the storage fixes at critical.
