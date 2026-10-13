# 02 — api-server: pool levels, CPU and each agent's share

**Depends on:** 01-runner-usage-share
**Part of:** Resource bars — see [README](./README.md)

## Context

`budgets.reserved.vm` from #4757 carries memory and storage totals and each agent's memory.
This slice adds a level per pool, CPU, and each agent's storage and CPU share, in the pinned contract of the README.

## Implementation plan

1. `packages/api-server/src/modules/budgets/domain/vm-usage.ts`: add `POOL_WARNING_PERCENT = 75`, `POOL_CRITICAL_PERCENT = 90` (replacing `STORAGE_FULL_PERCENT`), `CPU_SLOWED_PERCENT = 20` and `poolLevel(used, limit)` (limit 0 is `ok`), unless #4759 already added `poolLevel` on main — then reuse it.
   `vmUsageView` maps the levels, `cpu` (omitted when `limitMilli` is 0) and each agent's `storageUsedBytes` and `cpuMilli`; `storageRefusal` uses `poolLevel(...) === "critical"`.
2. `infrastructure/runner-usage.ts`: the Zod schema gains optional `cpu` and the machine fields with `.default(0)`.
3. `packages/api-server-api/src/modules/budgets/types.ts`: the pinned types; export `PoolLevel` from `api-server-api/src/index.ts`.
4. Unit tests for 74/75/90 levels, CPU omitted without a limit, only the caller's agents listed, and an older runner's answer still parsing; the #4757 refusal test goes through `poolLevel`.
5. Docs: the budgets read paragraph of `docs/architecture/budgets.md`. Apply `/typescript-engineering`.

## Acceptance criteria

- [ ] `reserved` returns the pinned shape.
- [ ] The create refusal and `storage.level === "critical"` always agree.
- [ ] The container fields are unchanged.

## Smoke test

`mise run //packages/api-server-api:check`, `mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run //packages/ui:check`.
