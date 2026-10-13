# 03 — api-server: per-user usage on read; refuse vm creates at 90%

**Depends on:** 02-controller-pool-disks
**Part of:** VM disks grow inside the user's storage pool — see [README](./README.md)

## Context

The api-server reads the caller's own runner for usage when it needs it, publishes it through the existing budgets read, and refuses a vm create once storage is at least 90% used.

## Implementation plan

Apply `/typescript-engineering`.

1. `packages/api-server/src/modules/budgets/infrastructure/`: a runner usage reader.
   It finds the caller's usage Secret by the owner label, calls `GET <url>/usage` with the capability over TLS trusting only `ca.crt`, times out after about 2 s, and caches per owner for about 10 s.
   No Secret, an unreachable runner or a bad answer reads as "unknown".
2. `budgets-service.ts` `reserved()`: add the optional `vm` block from the README contract, with `agents` filtered to the caller's own vm agents (a host runner serves every owner).
3. `api-server-api/src/modules/budgets/types.ts`: the `vm` type.
4. A domain check `storageRefusal(usage)`: refuse at `usedBytes / usableBytes >= 0.90` with the README error shape and copy: "Your agents' shared storage is N% full (X of Y GiB), so a new agent can't be created.
   Delete an agent you no longer need, clear caches inside your agents, or ask an admin for more storage."
   Unknown usage never refuses.
5. Call it in `agents-service.create` for `backend.type === "vm"` (covers kit apply and spawns that go through create) and in the runtime-migration start.
6. `spec-assembly.ts`: stop stamping `storageSize` on a vm create.
7. `api-server-api/src/trpc.ts` `errorFormatter`: `storageFull` beside `scanFailure`.
8. `usage/domain/build-analytics-report.ts`: exclude vm agents from the disk buckets.
9. Docs: `persistence.md` guard paragraph names the create refusal; `budgets.md` notes the budgets read's vm figures.

## Acceptance criteria

- [ ] `budgets.reserved` carries the vm block for a caller with a reachable runner, and omits it otherwise.
- [ ] A vm create, a kit apply on vm, a spawn and a migration at ≥90% fail with `PRECONDITION_FAILED` and `data.storageFull`; nothing is created.
- [ ] A container create, unknown usage, and use below 90% are never refused.
- [ ] The api-server never reads the runner token or TLS Secret.

## Smoke test

`mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run //packages/api-server-api:check`, `mise run //packages/cli:test`.
