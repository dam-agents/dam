# 02 — The controller reclaims as soon as the runner signals

**Depends on:** 01-runner-pressure
**Part of:** #4755 — see [README](./README.md)

## Context

With the runner's signal available, the controller holds one pressure watch per owner and reclaims on it at once, instead of waiting for the next 30 s pass.

## Implementation plan

1. `packages/controller/pkg/reconciler/vm_pressure_watch.go`, modelled on `vm_machine_watch.go`: one watch per owner on `AgentReconciler`, started from `reconcileVMAgent` after a successful ensure when the runner is in the cluster (`HostAddress == ""`) and has a limit, ended on `r.lifetime` and when the runner is deleted.
   A failed read ends the watch; the next reconcile starts another.
   A 404 (a runner release without the endpoint) leaves the 30 s pass to it.
2. `vm_memory.go`: `ownerMemoryPass` takes an optional pressure sample.
   When pressured it skips the 90% gate, needs the larger of the counted overshoot and the measured working set over the 80% target, and reclaims partially: the candidates chosen need not cover the whole need.
3. One pass per owner at a time, shared by the 30 s pass and the watch, and a short per-owner cooldown (15 s) after a reclaim under pressure, so machines still stopping are not reclaimed for again.
4. Tests in `vm_memory_test.go` with the fake runner in `vm_backend_test.go`.
5. Docs: `vm-memory.md` ("Room is freed", "What can still go wrong") and `budgets.md`, where the rules under a pressure signal now allow a partial reclaim.

## Acceptance criteria

- [ ] A pressured sample hibernates an idle unattended agent even when counted demand is under 90%.
- [ ] Under pressure, an agent is hibernated even when the candidates do not cover the whole need.
- [ ] Two passes for one owner do not run together, and the cooldown holds.
- [ ] No watch starts for the host runner; a 404 is tolerated quietly.
- [ ] The 30 s pass behaves as before.

## Smoke test

`mise run //packages/controller:test`, `mise run //packages/controller:check`, `mise run //docs:check`.
