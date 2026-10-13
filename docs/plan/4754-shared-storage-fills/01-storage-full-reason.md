# 01 — A `MachineStorageFull` reason and honest out-of-space labels

**Part of:** #4754 — see [README](./README.md)

## Context

A full claim today reads as a failed boot, and a full image cache on the runner's own claim reads as the memory refusal, which hibernates idle agents for nothing.

## Implementation plan

1. `packages/vm-runner/contract/vocabulary.json`: add `MachineStorageFull`; `src/api.rs`: `REASON_STORAGE_FULL` and its vocabulary test entry.
2. `src/fetch.rs`: `storage_full(detail)` constructor; `failure_reason` returns `REASON_STORAGE_FULL` for an error with no `Refusal` whose chain holds an `io::Error` with ENOSPC or EDQUOT.
3. `src/imagecache.rs`: `CacheConfig.full_reason`; `written`, `admit` and the unpack's out-of-room path report under it.
   The runner's own cache (`server.rs`) sets `REASON_STORAGE_FULL`, the node service (`src/bin/vm-image-cache.rs`) keeps `REASON_OUT_OF_CAPACITY`.
   `cacheapi.rs` passes the new reason through too.
4. `packages/controller/pkg/vmrunner/api.go`: `ReasonStorageFull`, plus `api_test.go`'s vocabulary list.
   The memory reclaim stays keyed on `ReasonOutOfCapacity`.

## Acceptance criteria

- [ ] An ENOSPC from a runner action reports `MachineStorageFull`.
- [ ] A full runner-owned cache reports `MachineStorageFull`; a full node cache still reports `MachineOutOfCapacity`.
- [ ] Both sides' vocabulary tests pass.

## Smoke test

`mise run //packages/vm-runner:test` and `mise run //packages/controller:test`.
