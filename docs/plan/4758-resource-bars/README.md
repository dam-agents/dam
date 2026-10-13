# Memory, CPU and storage bars replace the slot meter

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4758 (epic https://github.com/dam-agents/dam/issues/4753)

## Goal

A user with VM agents sees, on Home, how full their memory and storage pools are and whether their agents are being slowed down for CPU.
Each bar shows each agent's share, turns to a warning at 75% and to critical at 90%, and names the fix: pause idle agents for memory, delete the largest agents or clear caches for storage, and ask for more for both.
A user who still has container agents keeps the slot meter for those agents only, under "Container agents", until #4762 removes it.

## Approach

Read [budgets](../../architecture/budgets.md), [vm-memory](../../architecture/vm-memory.md) and the vm sections of [persistence](../../architecture/persistence.md) first.

- **Builds on #4757.** #4757 adds the runner's read-only `/usage` read and the optional `vm` block of `budgets.reserved`, read on demand from the caller's own runner with a 10 s cache.
  This feature starts after #4757 has merged.
- **No new CRDs or CRD fields.** Everything is computed on read through `budgets.reserved`, like the slot meter.
- **Levels on the server.** One `poolLevel()` in `packages/api-server/src/modules/budgets/domain/vm-usage.ts` defines 75% (warning) and 90% (critical).
  The create refusal from #4757 and the Slack alerts from #4759 use the same function; whichever of #4758 or #4759 lands first adds it, and the other reuses it.
- **Memory is the committed figure**, the count admission refuses at and reclaim acts on, so 90% on the bar means the same as 90% in the controller.
  Each agent's segment is its VMM's resident memory; the rest of the committed figure is shown as headroom.
- **Storage share is each machine's allocated disk bytes**, not its virtual size, which after #4757 equals the pool for every disk.
- **CPU has no fill bar.** The runner's CPU limit moves with how many machines run, and reaching it only slows agents down.
  The CPU row says whether the user's agents are being slowed down (cgroup `cpu.stat` throttling over the last minute) and lists the agents using the most CPU.
- **Fixes:** memory lists idle agents largest first with a one-click Pause and "Pause all"; never-hibernate agents get Stop with confirmation.
  Storage lists the largest agents, hibernated ones included, with a confirmed delete.
  #4757's storage-full dialog already sends the user to Home, where these fixes are shown.

## Pinned contract

Runner `GET /usage` (golden `packages/vm-runner/contract/runner-usage.json`) gains, on top of #4757's shape:

```json
{
  "cpu": { "limitMilli": 0, "usedMilli": 0, "throttledPercent": 0 },
  "machines": [{ "diskUsedBytes": 0, "cpuMilli": 0 }]
}
```

`cpu` is absent with no cgroup or no `cpu.max` limit; the machine fields default to 0 (unmeasured) for an older runner.

`budgets.reserved.vm` in `packages/api-server-api/src/modules/budgets/types.ts`:

```ts
export type PoolLevel = "ok" | "warning" | "critical"; // >=75 warning, >=90 critical, on the floored percent
export interface BudgetVmUsage {
  memory: { usedBytes: number; limitBytes: number; level: PoolLevel };
  storage: { usedBytes: number; usableBytes: number; level: PoolLevel };
  cpu?: { limitMilli: number; usedMilli: number; throttledPercent: number; slowed: boolean }; // slowed = throttled >= 20%
  agents: { id: string; memoryUsedBytes: number; storageUsedBytes: number; cpuMilli: number }[];
  observedAt: string;
}
```

`vm` stays absent when the caller has no runner or it could not be read.

## Sub-issues

| #   | Title                                                       | Scope                      | Depends on |
| --- | ----------------------------------------------------------- | -------------------------- | ---------- |
| 01  | Runner: usage reports each machine's disk and CPU, and throttling | vm-runner (Rust) + Go mirror | #4757 |
| 02  | api-server: pool levels, CPU and each agent's share         | api-server, api-server-api | 01         |
| 03  | UI: pool bars replace the slot meter on Home                | ui, e2e                    | 02         |
| 04  | UI: each bar names its fix                                  | ui                         | 03         |

## Conventions & glossary

- **Pool:** the owner's memory, CPU or storage limit, from the install unless #4756's per-user override sets it.
- **Committed memory:** each running machine's measured use plus headroom, capped at its size ([vm-memory](../../architecture/vm-memory.md)).
- **Slowed down:** the runner was throttled in at least 20% of its active CPU periods over the last 60 s.
- Go and Rust comments carry a `UNIT_BOUNDARY_DESCRIPTION:`/`TEST_SCENARIO:` prefix (`mise run //:check:comment-types`).
- Apply `/typescript-engineering` for api-server work and `/react-ui-engineering` for the UI.
- Every Markdown sentence on its own line (`mise run fix:markdown`).

## Whole-feature smoke test

On a local cluster with virtualization and a small per-user pool: create two vm agents, fill storage past 75% and then 90% with `fallocate` in a guest, and see the storage bar turn to warning and critical with the largest agent listed; leave one agent idle and see it listed under memory with Pause; run a CPU-bound loop in both guests and see the CPU row say slowed down.
A container-only user still sees the slot meter, under "Container agents".

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4758.
