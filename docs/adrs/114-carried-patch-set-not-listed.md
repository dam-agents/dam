---
id: 114
title: The carried patch set is verified against each release, and the record does not list what it holds
status: accepted
subsystem: vm-runner
tags: [vm, smolvm, patches]
summary: The platform still carries smolvm with an in-repo patch set that each release is verified against, and the record no longer names what the set holds, because a bump rebases it; the four fixes ADR-093 listed are the filesystem's, the runner's or the guest init's, not the set's.
---

# ADR-114: The carried patch set is verified against each release, and the record does not list what it holds

**Date:** 2026-10-21
**Status:** Accepted
**Amends:** ADR-093 — its patch-set sentence only; carrying smolvm and pinning it stay as decided.
**Owner:** @JanPokorny

## Context

ADR-093 decides that smolvm is carried, not forked, and in the same sentence lists the contents of the patch set that sits on the pin: a journal on storage disks, never formatting a disk that holds data, SIGTERM to the workload on stop, and discard.
A patch set is rebased on every smolvm release, so whatever it holds changes on a schedule the decision does not control.
None of the four fixes is in the set today.
The storage disk is btrfs, whose own crash-consistency machinery keeps its metadata, so no patch carries a journal.
The runner marks a disk that already holds a filesystem, and platform-init refuses to format a disk it cannot mount, so no patch keeps a disk from being formatted.
platform-init, the guest's init, is what forwards the stop signals to the workload and mounts the storage disk with synchronous discards, so neither is a patch either.
ADR-112 already amends what ADR-093 says about a guest's freed blocks reaching its owner's claim.
This record covers the separate sentence that listed discard among the patch set's fixes, and the three others beside it.

## Decision

**The platform still carries smolvm rather than forking it, with an in-repo patch set that every release is verified against, and the record no longer names what that set holds.**
What the set holds is not a stable decision: it is whatever a release still lacks, which changes at every bump.
A decision can pin that the set is carried and verified; it cannot pin its contents without going false at the next release.
The set today mixes several kinds of change — fixes for guest-reachable defects the release does not have, the kernel capabilities a guest needs, and the hooks that let the platform boot its own init — and which of them are still needed is a property of the release, not of this decision.

The verification is about the interface the release resolves, not about what the patches do.
The build refuses a rebuilt libkrun that exports a different set of `krun_*` symbols than the release's, because smolvm resolves those at runtime and a missing one fails a boot.
It refuses a rebuilt kernel whose version is not the release's.
Neither check looks inside the patches: a patch that changes hypervisor behaviour while keeping those symbols passes both, as this set's write-retry fix does.

## Amends

- **ADR-093** — its Decision says "an in-repo, verified patch set sits on it: a journal on storage disks, never formatting a disk that holds data, SIGTERM to the workload on stop, and discard."
  The verified patch set and the move to the latest release stand.
  The four fixes it names are not in the set: the storage disk is btrfs, which keeps its own metadata consistent; the runner and platform-init keep a disk that holds data from being formatted; and platform-init, the guest's init, forwards the stop signals and mounts the disk with the discards ADR-112 amends.
  ADR-112's amendment of that record stands untouched here.

## Alternatives Considered

- **Correct the list in place** — an accepted body is never rewritten, and a corrected list goes stale at the next bump just the same.
- **Supersede ADR-093 whole** — it decides the runtime, the move, the per-owner pool and the runner, and none of that changed; replacing it would re-open decisions nobody is revisiting.
- **Drop the sentence entirely** — carrying smolvm with a verified set is still a commitment a future reader has to keep, and it is the reason a bump costs a rebase.

## Consequences

- **Easier:** a smolvm bump no longer makes a record false, since the record no longer states what the set contains.
- **Harder:** the log no longer says what the patch set carries, so learning it means reading the patches. That cost was already paid, since the list had gone stale against the set it described.
- **Committed-to:** the patch set is carried and each release verified against it, at both ends the build checks: the symbol surface smolvm resolves, and the guest kernel's version.
- **Committed-to:** that verification is an interface check only. Nothing establishes that a patched build behaves as the release does, so a patch that changes behaviour has to be reviewed as a behaviour change.
