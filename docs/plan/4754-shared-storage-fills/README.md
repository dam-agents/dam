# A user's VM agents fail writes and risk data loss once their shared storage fills

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4754

## Goal

A user's VM agents share one storage claim: every machine disk, the runner's bookkeeping and, on its own claim, the image cache.
The disks are sparse, so they can add up to more than the claim holds, and nothing watches the claim.
Once it fills, a guest's write into its disk fails with EIO, ext4 warns of data loss, and the user sees a raw console dump under "the agent's microVM did not boot".

After this change the runner sheds what it can fetch again before the claim fills, refuses to create, start, restart or grow a machine once it is critically full, never touches a running machine, and names storage as the reason with the fixes a user can take.
A home that fills inside a guest is named as such too.

## Approach

The runner owns the guard, because it is the one process that sees the claim and admits every action ([vm-runner](../../architecture/vm-runner.md), [persistence](../../architecture/persistence.md)).
It measures the claim with `statvfs` on its state directory: used is `blocks - bfree`, usable is used plus `bavail`, so root-reserved blocks do not hide the point where the runner's writes fail.

- **75% used (short):** the runner's own image cache sheds every tree no machine holds, and every machine's share carries a flag that makes platform-init evict its scratch and caches.
  It clears below 70%.
- **90% used (critical):** a PUT that would create, start, restart or grow a machine is refused with the new reason `MachineStorageFull`, and a seed upload is refused with 507.
  An ensure that needs no action, and a stop, are never refused.

The reason is new runner vocabulary, carried through the controller unchanged, classified by the api-server as a terminal machine failure, and described with its fixes.
An out-of-space error the runner meets anywhere is reported under it rather than as a failed boot, and the runner's own cache no longer reports a full disk as the memory refusal `MachineOutOfCapacity`, which made the controller hibernate idle agents to free memory that was never short.
A node cache's full disk is the node's, not the owner's, and keeps `MachineOutOfCapacity`.

The thresholds are runner constants rather than new flags, so the runner's command line contract does not change.
A refused machine is not parked: parking halts a running machine, and the decision is to never kill one.

## Sub-issues

| #   | Title                                                            | Scope                                                                  | Depends on |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------- |
| 01  | [x] A `MachineStorageFull` reason and honest out-of-space labels | vocabulary, runner classification, controller constant                 | —          |
| 02  | [x] The runner guards its claim                                  | statvfs guard, refusals, cache shedding, seed refusal, gauges, docs    | 01         |
| 03  | [ ] Guests free scratch while the claim is short                 | share flag, platform-init eviction trigger                             | 02         |
| 04  | [ ] Users read why storage stopped their agent                   | api-server classification and copy                                     | 01         |
| 05  | [ ] A full home inside a guest is named                          | platform-init marker, runner reason, controller maps to HomeVolumeFull | 02         |

## Conventions & glossary

- **Claim:** the owner's runner PVC (`virtualization.runner.storage` is its ceiling).
- **Short / critical:** the 75% and 90% thresholds above.
- Rust follows the vm-runner crate's style; Go and TS follow their packages.
  Apply `/typescript-engineering` for the api-server slice.
- Every comment is a typed comment (`UNIT_BOUNDARY_DESCRIPTION:` / `TEST_SCENARIO:`); run `mise run check:comment-types`.

## Whole-feature smoke test

Not runnable in the agents' shared local cluster.
On a Linux KVM cluster: fill a runner pod's `/var/lib/platform/machines` past 90% with `fallocate`, wake a hibernated vm agent, and see its status say its owner's storage is full; a running agent stays up; the runner's `/metrics` shows `platform_vm_runner_storage_used_bytes`.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for #4754.
