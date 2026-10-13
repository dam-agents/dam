# 02 — The runner admits against its live memory limit

**Part of:** Per-user VM pools — see [README](./README.md)

## Context

The runner learns its memory limit once, from `--memory-mib` at start.
A limit resized in place would not reach its admission or its pressure check.
This slice makes it read the kernel's limit.

## Implementation plan

1. `packages/vm-runner/src/pressure.rs`: read `memory.max` from the cgroup directory; `max` or unreadable means no limit there.
2. `src/server.rs`: one function gives the memory limit — the cgroup's when `cgroup_dir` is set and it has one, else `config.memory_mib`.
   Use it for capacity, the pressure sample, the pressure read and the metrics gauge.
3. Unit tests over a fake cgroup directory.
4. Docs: `vm-memory.md` — the runner admits against the limit the kernel holds.

## Acceptance criteria

- [ ] With a fake cgroup whose `memory.max` changes, admission and the reported limit follow without a restart.
- [ ] With no cgroup, or `memory.max` = `max`, the flag is used.

## Smoke test

`mise run //packages/vm-runner:check`, `mise run //packages/vm-runner:test`.
