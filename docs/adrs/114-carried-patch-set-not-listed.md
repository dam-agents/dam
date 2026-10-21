---
id: 114
title: A carried patch set is verified on every bump, and the record does not list what it holds
status: accepted
subsystem: vm-runner
tags: [vm, smolvm, patches, storage]
summary: The platform still carries smolvm with a patch set verified against each release, but the record no longer names what the set holds, because a bump replaces it; the four fixes ADR-093 listed are the filesystem's, the runner's or the guest init's, so the set keeps only guest-reachable defects the platform cannot fix in its own code.
---

# ADR-114: A carried patch set is verified on every bump, and the record does not list what it holds

**Date:** 2026-10-21
**Status:** Accepted
**Amends:** ADR-093 — its patch-set sentence only; carrying smolvm and pinning it stay as decided.
**Owner:** @JanPokorny

## Context

ADR-093 decides that smolvm is carried, not forked, and in the same sentence lists the contents of the patch set that sits on the pin: a journal on storage disks, never formatting a disk that holds data, SIGTERM to the workload on stop, and discard.
A patch set is rebased or dropped on every smolvm bump, so that list is replaced on a schedule the decision does not control.
None of the four fixes is in the patch set today.
The storage disk is btrfs, which journals its own metadata, so no patch carries a journal.
The runner marks a disk that already holds a filesystem, and platform-init refuses to format one, so no patch keeps a disk from being formatted.
platform-init, the guest's init, is what forwards the stop signals to the workload and mounts the storage disk with synchronous discards, so neither is a patch either.
ADR-112 already amends what ADR-093 says about a guest's freed blocks reaching its owner's claim.
This record covers the separate sentence that listed discard among the patch set's fixes, and the three others beside it.

## Decision

**The platform still carries smolvm rather than forking it, with an in-repo patch set verified against each release, and the record no longer names what that set holds.**
What the set holds is not a stable decision: it is whatever a guest-reachable defect still needs before upstream ships the fix, which changes at every bump.
A decision can pin that the set is carried and verified; it cannot pin its contents without going false at the next release.
The fixes ADR-093 attributed to the set are properties of parts the platform owns: its own init in the guest, its own runner on the host, and the filesystem under the storage disk.
The set therefore keeps one kind of fix only, a guest-reachable defect in smolvm or in the hypervisor it embeds that the platform cannot fix in its own code.

## Amends

- **ADR-093** — its Decision says "an in-repo, verified patch set sits on it: a journal on storage disks, never formatting a disk that holds data, SIGTERM to the workload on stop, and discard."
  The verified patch set and the move to the latest release stand.
  The four fixes it names are not in the set: the storage disk is btrfs, which journals its own metadata; the runner refuses to format a disk that holds a filesystem; and platform-init, the guest's init, forwards the stop signals and mounts the disk with the discards ADR-112 amends.
  ADR-112's amendment of that record stands untouched here.

## Alternatives Considered

- **Correct the list in place** — an accepted body is never rewritten, and a corrected list goes stale at the next bump just the same.
- **Supersede ADR-093 whole** — it decides the runtime, the move, the per-owner pool and the runner, and none of that changed; replacing it would re-open decisions nobody is revisiting.
- **Drop the sentence entirely** — carrying smolvm with a verified set is still a commitment a future reader has to keep, and it is the reason a bump costs a rebase.

## Consequences

- **Easier:** a smolvm bump no longer makes a record false. Dropping all four named fixes from the set took no new decision, and three of them moved into platform-init and the runner, which the platform ships itself.
- **Harder:** the log no longer says what the patch set carries, so learning it means reading the patches. That cost was already paid, since the list had gone stale against the set it described.
- **Committed-to:** the patch set is carried and verified against every release, and the image build refuses a patched hypervisor whose exported symbols differ from the release's, so the set cannot silently change what smolvm is.
- **Committed-to:** a fix the platform can make in its own init or runner does not go into the patch set, because the platform ships those and rebases nothing to keep them.
