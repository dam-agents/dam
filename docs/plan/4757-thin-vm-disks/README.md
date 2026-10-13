# VM disks grow inside the user's storage pool

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4757 (epic https://github.com/dam-agents/dam/issues/4753)

## Goal

A user never sizes a VM agent's disk.
Every VM disk can grow up to the user's storage pool, and storage is counted by what the agents actually use.
Creating a VM agent is refused, with the figures and the three fixes (delete an agent, clear caches, ask an admin for more), once the user's storage is at least 90% used.

## Approach

Read [persistence](../../architecture/persistence.md) (the vm sections and the claim paragraph), [vm-runner](../../architecture/vm-runner.md), [vm-memory](../../architecture/vm-memory.md) and [budgets](../../architecture/budgets.md) first.

- **One pool, thin disks.** Each owner's claim is created at the owner's storage ceiling, and every machine disk's virtual size is that same ceiling.
  Disks are sparse, so the claim's filesystem use is the owner's real use, which is exactly what the runner's storage guard (#4775) already measures and acts on at 75% and 90%.
- **The ceiling resolver comes from #4756.** S2 builds on the per-owner pool lookup #4756 adds; S1 does not need it.
- **No restart for a bigger disk.** A grown disk is applied at the machine's next start (the same rule sizes follow), so the upgrade reboots nothing.
  The controller only sends the pool size to a runner whose status reports `diskGiB`, so an owner still on an old runner release keeps the old size until it hands off.
- **No new CRDs or CRD fields.** Per-user figures are computed on read, the way the slot meter's `budgets.reserved` already is: the api-server asks the caller's own runner for its use when it needs it, caches the answer for about 10 s, and fails open when there is no runner or it cannot be reached.
  The runner is authoritative anyway: it refuses creating, growing or booting at 90% (#4775).
- **A read-only usage capability.** The api-server never holds the runner token, which drives ensure and delete for every machine of the owner.
  The runner accepts on its usage route a capability derived from its token under a usage-only label (the same derivation as the seed capability, without machine, nonce or expiry, because it can only read).
  The controller mints it into a per-runner usage Secret beside the runner's CA certificate and URL, so the api-server never reads the runner's TLS Secret, which holds its private key.
- **Container agents are unchanged.** `spec.storageSize`, a mount's `size` and a kit's `resources.storage` stay accepted by every schema and keep sizing container volumes; on the vm backend they are ignored and documented as container-only.

## Sub-issues

| #   | Title                                                         | Scope                                 | Depends on       |
| --- | ------------------------------------------------------------- | ------------------------------------- | ---------------- |
| 01  | Runner: grown disks wait for the next start; usage read       | vm-runner (Rust) + Go client/contract | —                |
| 02  | Controller: disks and claim at the owner's pool; usage Secret | controller (Go), helm, docs           | 01, #4756 merged |
| 03  | api-server: per-user usage on read; refuse vm creates at 90%  | api-server, api-server-api            | 02               |
| 04  | UI: storage-full dialog; no disk sizes for vm                 | ui                                    | 03               |

## Usage contract (pinned for 01–04)

Runner route `GET /usage`, bearer = the usage capability or the runner token, answers JSON (golden `packages/vm-runner/contract/runner-usage.json`):

```json
{
  "storage": { "usedBytes": 0, "usableBytes": 0 },
  "memory": { "limitMiB": 0, "committedMiB": 0 },
  "machines": [{ "id": "agent-x", "state": "running", "usedMiB": 0, "diskGiB": 0 }]
}
```

`budgets.reserved` keeps its current fields and gains an optional `vm` block that #4758's bars consume:

```ts
vm?: {
  memory: { usedBytes: number; limitBytes: number };
  storage: { usedBytes: number; usableBytes: number };
  agents: { id: string; memoryUsedBytes: number }[];
  observedAt: string; // ISO time of the runner read
}
```

Absent when the caller has no runner or it could not be read.

The create refusal is `TRPCError({ code: "PRECONDITION_FAILED" })` with `data.storageFull = { usedBytes, usableBytes, percent }`, formatted like `scanFailure` in `packages/api-server-api/src/trpc.ts`.

## Conventions & glossary

- **Pool / ceiling:** the owner's storage limit, `virtualization.runner.storage` unless #4756's per-user override sets it.
- **Usage capability:** HMAC-SHA256 under a key derived from the runner token with label `vm-runner usage capability key v1`, over the scope `usage`; held to `contract/usage-capability.json` on both sides.
- Go and Rust comments must carry a `UNIT_BOUNDARY_DESCRIPTION:`/`TEST_SCENARIO:` prefix (`mise run //:check:comment-types`).
- Apply `/typescript-engineering` for api-server work and `/react-ui-engineering` for the UI.
- Every Markdown sentence on its own line (`mise run fix:markdown`).

## Whole-feature smoke test

On a local cluster with a small `virtualization.runner.storage`: create a vm agent and see `df -h ~` in the guest report about the pool; fill the claim past 90% (`fallocate` in a guest); see the home dashboard's budgets read carry the vm figures and a new vm create fail with the storage-full dialog; free space and create again.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4757.
