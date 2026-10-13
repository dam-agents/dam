# 01 — Runner: usage reports each machine's disk and CPU, and throttling

**Part of:** Resource bars — see [README](./README.md)

## Context

The runner's `/usage` read from #4757 reports storage and memory totals and each machine's resident memory.
The bars also need each machine's share of the storage pool, each machine's CPU, and whether the runner is being throttled.

## Implementation plan

1. Add `packages/vm-runner/src/cpu.rs`: parse cgroup v2 `cpu.stat` (`usage_usec`, `nr_periods`, `nr_throttled`) and `cpu.max` (to milli-CPUs; `max` means none), and keep a 60-sample window that gives `throttledPercent` (Δnr_throttled × 100 / Δnr_periods, 0 with no periods) and `usedMilli` (Δusage_usec / Δt).
   Tempdir tests in the style of `pressure.rs`.
2. `src/server.rs`: the per-second pressure sampler also samples `cpu.stat` into state beside the pressure state; with no cgroup (host runner, cgroup v1) no CPU is reported.
3. `src/runtime.rs`: add `disk_used_bytes(&self, id) -> Option<u64>` and `cpu_usec(&self, id) -> Option<u64>` with `None` defaults.
4. `src/embedded.rs`: disk use is `st_blocks * 512` summed over the machine's disk files; CPU is utime + stime from `/proc/<pid>/stat` over `CLK_TCK`, beside `resident_mib`.
   The prober keeps each machine's previous CPU sample to derive `cpuMilli`.
5. `src/api.rs`: add `CpuUsage` and the machine fields `disk_used_bytes` and `cpu_milli` (skipped when zero); fill them in `usage()`.
   Update `contract/runner-usage.json` and its zero golden.
6. Go mirror in `packages/controller/pkg/vmrunner/api.go` and `api_test.go`.
7. Docs: `docs/architecture/vm-runner.md` (what the usage read reports) and the guard paragraph of `persistence.md`; replace text rather than add, because of the page size limit.

## Acceptance criteria

- [ ] `/usage` carries `cpu` only when `cpu.max` sets a limit.
- [ ] `throttledPercent` matches fixture deltas.
- [ ] A sparse 100 GiB disk holding 1 MiB reports about 1 MiB as `diskUsedBytes`.
- [ ] Both goldens round-trip in Rust and Go.

## Smoke test

`mise run //packages/vm-runner:check`, `mise run //packages/vm-runner:test -- --lib cpu api server http`, `mise run //packages/controller:test`, `mise run //:check:comment-types`, `mise run //docs:check`.
