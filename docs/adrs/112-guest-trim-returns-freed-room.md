---
id: 112
title: A machine's freed blocks reach its owner's claim by a discard as the filesystem frees them, and a shrinking share gives its room back whole
status: accepted
subsystem: vm-runner
tags: [vm, storage, trim, btrfs]
summary: The guest's storage disk discards an extent as its filesystem frees it and trims the disk every minute as well, so a machine's freed blocks reach its owner's claim, and a machine's share gives its room back as whole files instead of a shorter one; a device that refuses discards returns nothing, and no guard move can stand in for that.
---

# ADR-112: A machine's freed blocks reach its owner's claim by a discard as the filesystem frees them

**Date:** 2026-10-20 **Status:** Accepted **Owner:** @JanPokorny **Amends:** ADR-093

## Context

ADR-093 counted on the guest's own discards, and on the runner's storage guard, to keep an owner's claim in step with what its machines write and free.
Neither held.
A guest's filesystem discarded nothing as it freed blocks, so the disk file the claim pays for kept them; a discard asked for once a minute is the only thing that could return them, and nothing asked.
The storage guard that holds a machine to its share then preallocated over the room a guest had just freed, and a guard asked only for a shorter length kept the blocks it had.
A claim therefore only ever grew: deleting 300 MiB of an agent's files left the claim where it was while the agent existed, and a steadily writing agent was refused at its share with the owner's claim only 73–86% full, and stayed refused.

## Decision

A machine's freed blocks reach its owner's claim by a discard the guest's filesystem issues as it frees them, and the room a machine's share gives up returns as whole files.
Only a discard returns backing storage: on a device that supports none, or whose discard fails, a deleted file keeps its blocks on the claim however the guard moves, and a later trim can only retry the ranges still free.

- **Discard as the filesystem frees.** platform-init mounts the guest's storage disk with synchronous discards, so an extent reaches the disk file the owner's claim pays for before the filesystem can hand it out again. Only a successful discard does: a failed one leaves the extent allocated, and the filesystem may then reuse it.
- **The trim is a second attempt, not a fallback.** platform-init also trims the whole disk every minute, and before the guard preallocates, asking for every free range with no minimum of its own, since a home of many small files frees its room in ranges below any minimum. It uses the same device discard as the mount, so on a device that refuses discards it returns nothing: it recovers ranges that are still free on a device that accepts them, and cannot recover a range the guard has since allocated. It also does not depend on the mount's automatic discards: turning those off leaves this trim working, and turning the trim off leaves the mount's discards working.
- **Whole files.** The guard is a set of unnamed preallocated files of one 16 MiB step each: a growth adds files and a shrink drops them, so every release is a file the filesystem loses, which both filesystems free in full. A single file shortened in place, or one whose tail alone was punched, would report the smaller size from its own stat while btrfs kept the whole physical allocation of the extent it only partly released. A disk that refuses a file leaves the guard at the size it had, and what it holds is read back from its files' blocks, because a refused preallocation need not take back the extents it placed.
- **What the guard is.** Room a guest may write is held by those files, sized to a share of what the owner's claim has left: the room below the claim's 95% level, divided among the machines that run, never less than a 256 MiB floor, resized in 16 MiB steps. The floor lets an agent held near zero still write its keys, a shell and its own state, and each running machine may therefore take the claim past the 95% level by one floor. Nothing reserves the claim's last 5%: a floor, a machine that writes between two looks and an estimate of free space that measures short can each reach into it, and the runner refuses to start a machine past that level, which is what keeps the overshoot bounded.

## Amends

- **ADR-093** — its Decision says "The guest discards freed blocks, and the runner stops a machine before the owner's claim fills."
  The guest discarded nothing as it freed blocks, because nothing asked it to: that record counted on discards no mount or trim of this platform issued, and the guard that holds a machine to its share came after it, in the work this record describes. Its per-owner pool, its storage share and its level before the claim fills stay as decided.

## Consequences

- **Easier:** a user who deletes files sees their storage bar fall without deleting the agent, one trim of the disk at most behind.
- **Easier:** a writing agent is refused by the guest at its share rather than at the claim's last block, so one agent at its limit leaves the owner's other agents writing.
- **Harder:** every delete that frees an extent waits for its discard to reach the disk file on the owner's claim, so removing a home of many files is slower than it was.
- **Harder:** on a device that supports no discard, or whose discards fail, the room a machine frees stays on the claim: dropping the guard's files frees guest extents, and only a discard empties their backing. A later trim retries the ranges still free if the device accepts one, and the guard's own move cannot return backing storage on its own.
- **Committed-to:** the room a machine frees reaches its owner's claim by a device discard, issued by the guest's filesystem as it frees and by the whole-disk trim as a second attempt; on a device without working discards no room returns, which is a limit of the storage under the claim and not something the platform works around.
- **Committed-to:** the guard holds its share throughout a move, and every release is a whole file, so it is never emptied to resize and never releases part of an allocation.

## Alternatives Considered

- **A trim a minute and nothing else** — a delete that a guard move races is taken by the guard before the trim reaches it, and the room stays on the claim until that guard moves again.
- **Asynchronous discards on the mount** — the same discards, queued: the allocator may reuse a freed extent before its discard runs, which is the race again.
- **Ask for a shorter guard file** — btrfs kept the blocks of a preallocated extent asked only for a shorter length while its own stat reported the smaller size, which wedged a steadily writing agent with a quarter of the claim unwritten. Punching the tail of one file fails the same way: the kernel shortens the extent's length but keeps its physical allocation until the whole extent goes.
- **Count on the guard's move to return room on a device without discards** — it cannot: the guard's blocks are guest extents, and only a discard empties their backing.
- **Trust the file's length for the room it holds** — a refused preallocation need not take back what it placed, so what the guard holds is read from its blocks.
