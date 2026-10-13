# 03 — UI: pool bars replace the slot meter on Home

**Depends on:** 02-api-pool-levels
**Part of:** Resource bars — see [README](./README.md)

## Context

Home shows a slot meter of container compute, which says nothing for VM agents.
This slice adds the memory and storage bars and the CPU row for VM agents, and keeps the slot meter, retitled "Container agents", only for users who still have container agents.

## Implementation plan

Apply `/react-ui-engineering`: server data from the TanStack cache only, hover as local state, no store.

1. `packages/ui/src/modules/budgets/api/queries.ts`: `usePoolUsage()` reads `trpc.budgets.reserved` with `select: (d) => d.vm` and `refetchInterval: 15_000`, polling only while Home is mounted.
2. New pure `budgets/lib/pools.ts`, tested in `packages/ui/src/__tests__/unit/pools.test.ts`: `memoryBar` (running vm agents by resident memory, plus headroom) and `storageBar` (every vm agent including hibernated ones by allocated bytes, plus "caches and system"); both fold a thin tail into "N more" and return percent and level.
3. Move `useHoveredSegment` out of `components/slot-bar.tsx` into `budgets/hooks/use-hovered-segment.ts`.
4. New `components/pool-bar.tsx`: a segmented bar with `role="meter"`, tone by level, and the percent plus "Getting full"/"Full" as text so colour is not the only signal; a hover card per segment names the agent and its share and links to its settings.
5. New `components/cpu-row.tsx`: "Not slowed down", or a warning naming the top agents by `cpuMilli`.
6. New `components/pool-usage.tsx` with the header "Your agents' resources", memory, storage and CPU rows, a shared `RequestMoreLink` extracted from `compute-usage.tsx`, and "Usage is unavailable right now" when the user has vm agents but `vm` is absent.
7. `modules/home/views/home-view.tsx`: render `PoolUsage` when the user has a vm agent and `ComputeUsage`, retitled "Container agents", when they have a container agent.
8. VM row share: `agents/utils/sandbox-subtitle.ts` and `hooks/use-agent-rows.ts` show "1.2 GiB memory · 8.4 GiB storage" for vm agents.
9. e2e: in `packages/e2e/playwright/src/tests/smoke/19-agent-backend.spec.ts` (vm lane only), Home shows the memory and storage meters and the agent's segment names it.
10. Docs: the Slots paragraph of `budgets.md` and one line in `vm-memory.md`.

## Acceptance criteria

- [ ] A vm-only user sees memory, storage and CPU rows and no slot meter.
- [ ] A container-only user sees the slot meter, titled "Container agents"; a mixed user sees both.
- [ ] Segments add up to the bar, and hovering one names the agent and its share.
- [ ] Levels come from the server.
- [ ] VM rows show their share.

## Smoke test

`mise run //packages/ui:check`, `mise run //packages/ui:test`, `mise run //packages/e2e/playwright:check`; on a local cluster with virtualization, agent-browser screenshots of Home in the ok, warning and critical states and of a segment hover card.
