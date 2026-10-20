---
id: 112
title: A machine's freed blocks reach its owner's claim by a discard as the filesystem frees them, and a shrinking share gives its room back whole
status: accepted
subsystem: vm-runner
tags: [vm, storage, trim, btrfs]
summary: The guest's storage disk discards an extent as its filesystem frees it and trims the disk every minute as well, so a machine's freed blocks reach its owner's claim, and a machine's share gives its room back as whole extents instead of a shorter file.
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

A machine's freed blocks reach its owner's claim by a discard the guest's filesystem issues as it frees them, and the room a machine's share gives up returns as whole extents.

- **Discard as the filesystem frees.** The guest's storage disk is mounted with synchronous discards, so an extent reaches the disk file the owner's claim pays for before the filesystem can hand it out again. A trim of the whole disk runs every minute as well, for a device whose discards fail and for blocks an older guest freed; it asks for every free range, with no minimum of its own, since a home of many small files frees its room in ranges below any minimum.
- **Whole extents.** A share that shrinks takes its new size as an allocation of its own before the old file is dropped. A disk that cannot hold both punches the tail out of the file it has and then shortens it, so the guard's blocks never fall below the size it moves to. A filesystem that refuses the move leaves the guard at the size it had, and what it holds is read back from its blocks, because a refused preallocation need not take back the extents it placed.
- **What the guard is.** Room a guest may write is held by a preallocated file sized to a share of what the owner's claim has left: the room below the claim's 95% level, divided among the machines that run, never less than a 256 MiB floor, resized in 16 MiB steps. The floor lets an agent held near zero still write its keys, a shell and its own state, and each running machine may therefore take the claim past the 95% level by one floor. Nothing reserves the claim's last 5%: a floor, a machine that writes between two looks and an estimate of free space that measures short can each reach into it, and the runner refuses to start a machine past that level, which is what keeps the overshoot bounded.

## Amends

- **ADR-093** — its Decision says "The guest discards freed blocks, and the runner stops a machine before the owner's claim fills."
  The guest discarded nothing as it freed blocks, and the storage that holds a machine to its share came after that record and is described here.
  Its per-owner pool, its storage share and its level before the claim fills stay as decided.

## Consequences

- **Easier:** a user who deletes files sees their storage bar fall without deleting the agent, one trim of the disk at most behind.
- **Easier:** a writing agent is refused by the guest at its share rather than at the claim's last block, so one agent at its limit leaves the owner's other agents writing.
- **Harder:** every delete that frees an extent waits for its discard to reach the disk file on the owner's claim, so removing a home of many files is slower than it was.
- **Harder:** a device that supports no discard keeps the room a machine frees until the guard next moves: dropping or shortening the guard file frees guest extents, and only a discard empties their backing, which such a device refuses.
- **Committed-to:** the guest's filesystem is what returns freed blocks, by discarding them as it frees them; a mount or an image that turns discards off costs that guarantee.
- **Committed-to:** the guard holds its share throughout a move, so it can afford the headroom of one whole allocation at a time and is never emptied to resize.

## Alternatives Considered

- **A trim a minute and nothing else** — a delete that a guard move races is taken by the guard before the trim reaches it, and the room stays on the claim until that guard moves again.
- **Asynchronous discards on the mount** — the same discards, queued: the allocator may reuse a freed extent before its discard runs, which is the race again.
- **Ask for a shorter guard file** — btrfs kept the blocks of a preallocated extent asked only for a shorter length while its own stat reported the smaller size, which wedged a steadily writing agent with a quarter of the claim unwritten.
- **Trust the file's length for the room it holds** — a refused preallocation need not take back what it placed, so what the guard holds is read from its blocks.
