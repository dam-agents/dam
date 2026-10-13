# 05 — A full home inside a guest is named

**Depends on:** 02-runner-storage-guard
**Part of:** #4754 — see [README](./README.md)

## Context

On the container backend a full home is published as `HomeVolumeFull` from the container's termination message.
A machine has none, so a full home reads as a guest that stopped answering.

## Implementation plan

1. `platform-init/src/guest.rs`: a fixed console marker.
   `boot.rs` `supervise`: when the entrypoint exits non-zero and the home has under 64 MiB free (agent-runtime's threshold), announce it.
2. `src/console.rs`: `home_full(tail)` finds the marker after the last hand-off line.
3. `src/server.rs` `note_slow_boot`: a boot whose console shows the marker carries the note under the new reason `MachineHomeFull` (vocabulary, `api.rs`, `api.go`).
4. `packages/controller/pkg/reconciler/vm_agent.go` `publishVMReadiness`: `MachineHomeFull` becomes `apiv1.ReasonHomeVolumeFull`, so the api-server's and UI's existing copy apply.

## Acceptance criteria

- [ ] The marker is found, and ignored after a later hand-off.
- [ ] The controller publishes `HomeVolumeFull` for it.

## Smoke test

`mise run //packages/vm-runner:test`, `mise run //packages/controller:test`, `mise run //packages/api-server:test`.
