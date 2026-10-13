# 02 — Controller pool gauges and the RunnerCapacity condition

**Depends on:** 01-runner-cpu-pressure-metrics; PRs #4798 and #4797 merged
**Part of:** operator pool metrics — see [README](./README.md)

## Context

Nothing tells an operator how much the users' pools promise against what the nodes hold, and a resize the node cannot give is only logged.

## Implementation plan

1. `packages/controller/pkg/telemetry/metrics.go`: observable gauges fed from a snapshot the leader sets:
   - `platform.vm_pool.committed`, `platform.vm_pool.reserved`, `platform.vm_pool.capacity`, each by `resource` (memory, cpu, storage)
   - `platform.vm_pool.runners` by `resource` and `level` (ok, warning, critical)
   - `platform.vm_runner.resize_pending` by `reason` (deferred, infeasible)
2. New `packages/controller/pkg/reconciler/vm_pool_metrics.go`, run from the 30 s `MemoryPass` tick (`main.go`), leader only: list the runner pods, nodes offering the runner's device-plugin resource, the runner claims and `CSIStorageCapacity` for the runner StorageClass; compute the sums; take each owner's level from the readings the pass already made, with the epic's 75/90.
3. `vm_runner_sizing.go` `reportResizePending`: keep the log, and record the pending state per owner.
4. `vm_agent.go` `publishVMReadiness`: set or remove a `RunnerCapacity` condition (constants in `api/v1/agent_types.go`, no type change) from that state; readiness is untouched.
5. A Warning Event on each of the owner's vm Agents when the state appears, and when a pool reaches critical, once per state; share the Event writer with `migrationEvent` in `runtime_migration.go`.
6. RBAC in `helm/templates/controller/rbac.yaml`: `csistoragecapacities` list (nodes list already exists).
7. Docs: `vm-memory.md` (the scheduler-reserves paragraph), `vm-runner.md` (what the controller reports), `observability.md` (platform-service export).

## Acceptance criteria

- [x] Gauges carry only `resource`, `level` and `reason`.
- [x] An infeasible resize puts `RunnerCapacity=False/Infeasible` and one Warning Event on each of the owner's vm Agents, leaves Ready alone, and clears once the resize applies.
- [x] Only the leader exports; storage capacity is absent without `CSIStorageCapacity`.

## Smoke test

`mise run //packages/controller:check`, `mise run //packages/controller:test`, `mise run //helm:check`, `mise run //docs:check`, `mise run //:check:comment-types`.
