# 01 — The runner reports memory pressure within a second

**Part of:** #4755 — see [README](./README.md)

## Context

The runner learns how full its pool is only from each VMM's RSS every 10 s, and tells nobody until asked.
This slice has it read its own cgroup every second and answer a long-poll when pressure starts.

## Implementation plan

1. `packages/vm-runner/src/pressure.rs` (register in `lib.rs`): read `memory.current`, `memory.stat` `inactive_file` under a given cgroup directory; working set = current less inactive file.
   A pure `pressured(working_set_mib, limit_mib, was) -> bool`: on at ≥95%, off below 90%.
2. `src/server.rs`: `Config.cgroup_dir: Option<PathBuf>`; a pressure state in `Machines` (version, pressured, working-set MiB, last signal); a sampler on `server.background` every 1 s.
   On a change of pressure, and every 10 s while it lasts, it first refreshes `resident_mib` of every running machine, then bumps the version from `versions` and notifies `changed`.
   `pressure()` and `wait_pressure(since, timeout)` mirror `wait`.
3. `src/http.rs`: `GET /pressure` behind the token, reusing the `wait`/`since` query.
4. `src/main.rs`: on Linux `cgroup_dir = Some("/sys/fs/cgroup")`, else None; no new flag.
   Missing files turn sampling off with one log line.
5. Contract: `RunnerPressure {version, pressured, limitMiB, workingSetMiB}` in `src/api.rs`, fixtures `contract/runner-pressure.json` and `.zero.json`, both contract tests.
   Go: `RunnerPressure` in `packages/controller/pkg/vmrunner/api.go`, `Client.WaitPressure` in `client.go`, and the contract test in `api_test.go`.
6. Docs: the pressure read in `docs/architecture/vm-runner.md`'s machine API list, and in `vm-memory.md` that the runner watches its own cgroup.

## Acceptance criteria

- [ ] With fake cgroup files at 96%, `wait_pressure` answers within about a second with `pressured=true` and a new version, and running machines report freshly measured `usedMiB`.
- [ ] Below 90% it answers unpressured; between 90% and 95% it keeps its last state.
- [ ] Without a cgroup the version never moves.
- [ ] Both sides' contract tests pass.

## Smoke test

`mise run //packages/vm-runner:test`, `mise run //packages/vm-runner:check`, `mise run //packages/controller:test`, `mise run //docs:check`.
