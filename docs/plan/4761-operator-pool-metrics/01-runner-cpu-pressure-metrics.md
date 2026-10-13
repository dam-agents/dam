# 01 — Runner CPU and pressure metrics

**Part of:** operator pool metrics — see [README](./README.md)

## Context

The runner's scrape has memory and storage, but nothing on CPU and nothing on the pressure its sampler already sees, so neither throttling nor a runner near its kill point can be charted or alerted.

## Implementation plan

1. Add `packages/vm-runner/src/cpu.rs` (register in `lib.rs`): `CpuStat { usage_usec, nr_periods, nr_throttled }` read from the cgroup's `cpu.stat`, and `limit_milli` from `cpu.max` (`max …` is no limit).
   Tempdir tests in the style of `pressure.rs`.
2. `metrics.rs` `Gauges`: add `cpu: Option<CpuStat>`, `cpu_limit_milli: Option<i64>`, `working_set_mib: Option<i32>`, `pressured: Option<bool>`; render, all unlabelled:
   - `cpu_limit_millicores` (gauge, NaN without a limit)
   - `cpu_usage_seconds_total`, `cpu_periods_total`, `cpu_throttled_periods_total` (counters; NaN without a cgroup)
   - `memory_working_set_mib` and `memory_pressure` (0/1), NaN without a cgroup
3. `server.rs` `metrics_text`: read `cpu.stat`/`cpu.max` from `config.cgroup_dir` at scrape time and take the working set and pressure from the sampler's state.
4. Update the module comment in `metrics.rs` and its pinned-series test, and the VM runner section of `docs/architecture/observability.md`.

## Acceptance criteria

- [x] With a fake cgroup, the scrape shows the CPU limit, the three counters, the working set and pressure, with no labels.
- [x] Without a cgroup, every new series reads NaN; nothing fails.
- [x] Existing metrics tests pass.

## Smoke test

`mise run //packages/vm-runner:check`, `mise run //packages/vm-runner:test -- --lib cpu metrics pressure`, `mise run //:check:comment-types`, `mise run //docs:check`.
