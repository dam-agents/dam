# 02 — The runner guards its claim

**Depends on:** 01-storage-full-reason
**Part of:** #4754 — see [README](./README.md)

## Context

The runner admits machines by memory alone and never looks at its claim, so it keeps creating disks and booting guests into a claim with no room left.

## Implementation plan

1. New `src/storage.rs`: `StorageUse { used, usable }`, `measure(dir)` by statvfs, and pure `critical()` / `short(was)` with the thresholds; the refusal message names use, size and the fixes.
2. `server::Config.storage`: the measurement as an injectable function, so tests can fake a full claim; `main.rs` measures the state directory.
3. `Server::put`: when the claim is critical and the PUT would boot or create a machine, refuse it under `MachineStorageFull` (generalise `refuse` to take the reason).
   A PUT needing no action, and a stop, pass.
4. `Server::run`: an action that failed as a boot on a critical claim reports `MachineStorageFull`, keeping the console tail.
   `note_slow_boot`: a boot that never answers on a critical claim carries the storage note under that reason.
5. `Server::claim_seed`: refused with 507 on a critical claim; the copy Job retries anything but 413.
6. A storage tick beside the hold refresh: while short, the image cache sheds every tree no machine holds (`Images::shed`, a no-op for the node cache client).
7. Gauges `platform_vm_runner_storage_used_bytes` and `platform_vm_runner_storage_usable_bytes` in `metrics.rs` and its pinned list.
8. Docs: persistence.md (the claim), vm-image-cache.md (shedding), observability.md (the gauges).

## Acceptance criteria

- [ ] At 91%, a create, a start of a stopped machine and a restart are refused with `MachineStorageFull`, nothing is created, and a running machine whose ensure needs nothing stays up.
- [ ] At 76%, the runner-owned cache sheds to held trees.
- [ ] The metrics test lists the new gauges.

## Smoke test

`mise run //packages/vm-runner:test`, `mise run //packages/vm-runner:check`, `mise run //docs:check`.
