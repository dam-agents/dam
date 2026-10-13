# 03 — The owner's pool reaches the runner pod in place

**Depends on:** 01-userbudget-overrides, 02-runner-live-limit
**Part of:** Per-user VM pools — see [README](./README.md)

## Context

With the pool resolved and the runner reading its live limit, the controller applies the owner's memory and CPU pool to the running pod and to everything it computes from the limit.

## Implementation plan

1. `vm_memory.go`: the runner limit is the owner's pool; `runnerOvershootMiB` and `accountedMemoryMiB` take the owner.
2. `vm_runner_sizing.go`: `machineMemoryMiB` uses the owner's pool; `resizeRunnerPod` also sets `limits.memory` — the pool when it is at least the current limit, else the larger of the pool and the machines' count plus reserve (rounded to the request step), never above the current limit; the request floor is clamped to that limit; the CPU ceiling is the owner's `cpu`.
3. `runnerRequestMoves`: also reports a memory limit that differs, so the memory pass reconciles a changed pool.
4. `vm_runner.go` `applyRunnerDeployment`: render the owner's memory limit; `vm_runner_release.go` `runnerRollSpec`: leave the memory limit out of what the roll compares.
5. Tests in `vm_runner_sizing_test.go`, `vm_memory_test.go`, the rollout tests.
6. Docs: `vm-memory.md`, `vm-runner.md`, `vm-runner-upgrades.md` as needed; `helm/values.yaml` comment on `runner.resources`.

## Acceptance criteria

- [ ] A UserBudget `memory` changes that owner's runner pod `limits.memory` in place within one memory pass; other owners are untouched.
- [ ] A lowered pool keeps the limit at the machines' count and lowers it as they stop; reclaim targets the new pool.
- [ ] A pool change and the release carrying this change roll no runner pod.
- [ ] A UserBudget `cpu` caps that owner's runner CPU limit.

## Smoke test

`mise run //packages/controller:test`, `mise run //packages/controller:check`, then the README's whole-feature smoke test on a local cluster.
