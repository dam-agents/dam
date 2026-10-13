# 01 — Runner: grown disks wait for the next start; usage read

**Part of:** VM disks grow inside the user's storage pool — see [README](./README.md)

## Context

Two runner changes the rest needs: a larger requested disk must not restart a running machine, and the runner must answer a read-only usage read the api-server can call without the runner token.
It also reports each machine's disk size, so the controller can tell a runner that applies a grown disk at the next start from an older one.

## Implementation plan

1. `packages/vm-runner/src/plan.rs` `changed()`: drop `storage_gib`; update its description (a grown disk is applied at the next start, like sizes).
   Fix the plan tests that expect a restart on growth.
2. `src/api.rs` `MachineStatus`: add `#[serde(rename = "diskGiB", skip_serializing_if = "is_zero")] disk_gib: i32`, filled in `server.rs` `report` from the machine's applied spec (the disk the runner made or grew).
   Update `contract/machine-status*.json`.
3. `src/api.rs`: `RunnerUsage { storage: { usedBytes, usableBytes }, memory: { limitMiB, committedMiB }, machines: [{ id, state, usedMiB, diskGiB }] }` and golden `contract/runner-usage.json`(+`.zero.json`); add to the wire-type contract test.
4. `src/capability.rs`: `mint_usage(key)` / `verify_usage(key, presented)` under the label `vm-runner usage capability key v1`, scope `usage`, no machine/nonce/expiry; golden `contract/usage-capability.json`.
5. `src/http.rs`: `GET /usage`, outside the token-only layer; authorized by the token or a valid usage capability (constant-time compare).
   Handler builds `RunnerUsage` from `storage::measure` (the #4775 guard), the capacity's limit and committed figure, and each machine's last status.
6. Go mirror in `packages/controller/pkg/vmrunner/`: `DiskGiB` on `MachineStatus`, `RunnerUsage`, `MintUsageCapability(token)` in `capability.go`, and the contract tests (`api_test.go`, `capability_test.go`).
7. ext4 spike: measure a 10 → 100 GiB grow at boot and a fresh 100 GiB disk (boot delta, `du` of the disk file).
   Record the numbers in the PR.
   If inode-table init allocates real blocks, patch the storage mount in `smolvm.patch` (`noinit_itable`) or note the follow-up.
   This needs a KVM host; if none is free, record it as pending.
8. Docs: `docs/architecture/vm-runner.md` machine API list gains *usage* (keep the page under its size limit — replace, don't add).

## Acceptance criteria

- [ ] A running machine whose desired storage grows is not restarted; its next start grows the disk.
- [ ] `MachineStatus.diskGiB` reports the disk size; both sides' goldens round-trip.
- [ ] `/usage` answers to the token and to a usage capability, and refuses a seed capability or nothing (401).
- [ ] A usage capability is refused on every other route.
- [ ] Rust and Go mint the same capability from the contract fixture.

## Smoke test

`mise run //packages/vm-runner:check`, `mise run //packages/vm-runner:test -- --lib plan capability http api storage`, `mise run //packages/controller:test`, `mise run //:check:comment-types`, `mise run //docs:check`.
