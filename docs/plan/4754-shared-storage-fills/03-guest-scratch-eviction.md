# 03 — Guests free scratch while the claim is short

**Depends on:** 02-runner-storage-guard
**Part of:** #4754 — see [README](./README.md)

## Context

A guest sees its whole virtual disk as free, so platform-init's scratch eviction, which waits for the guest's own disk to run short, never runs while the claim under it fills.

## Implementation plan

1. `platform-init/src/guest.rs`: `STORAGE_SHORT_PATH` in the share.
2. `src/share.rs`: write or remove that file; the storage tick sets it in every machine's share while the claim is short.
3. `platform-init/src/boot.rs` `evict_scratch`: also evicts while the flag is present, and stops once it is gone and the guest's own target is met.
   smolvm's guest agent trims freed space back to the claim.

## Acceptance criteria

- [ ] The flag is written while short and removed below 70%.
- [ ] Eviction runs on the flag, and still deletes only what `evict_older` allows.

## Smoke test

`mise run //packages/vm-runner:test`.
