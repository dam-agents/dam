---
id:
title: Runtime migration is reversible until the first verified vm boot
status: proposed
supersedes:
subsystem: vm-runner
tags: [vm, migration, controller, api-server]
summary: A runtime migration keeps the container Agent authoritative until its machine has booted from the copy and answered; the api-server switches the Backend only after the controller reports that, and until then the user can abort back to the container, or retry after a bounded failure.
---

# ADR-NNN: Runtime migration is reversible until the first verified vm boot

**Date:** 2026-09-28
**Status:** Proposed
**Owner:** @JanPokorny

## Context

The runtime migration switched `spec.backend` to `vm` in the same write that requested it, and the controller then deleted the container's StatefulSet before anything had shown that the owner's VM runner could schedule, pull the image or hold the disk. Nothing could put the Agent back: the pre-migration spec was overwritten, a failing copy was retried every ten minutes without end, and progress lived in free-text annotations. A runner that never schedules left the Agent down indefinitely, with only hand edits to recover it.

## Decision

A runtime migration is reversible until the Agent's machine has booted from the copied home and its guest has answered; only then does the Backend switch for good. Until that point the container spec stays the Agent's spec, and the vm side is something the controller builds beside it.

- **The api-server stays the only spec writer.** Requesting a migration writes no spec: it records the target shape (the rewritten mounts and disk size) and a snapshot of the fields the switch changes (Backend, mounts, storage size, runtime class, node selector). The controller reports progress on the Agent's status; the api-server switches the Backend when the controller reports a verified boot.
- **Preflight before downtime.** The controller first makes the owner's runner and the Agent's machine, stopped, while the container keeps running. Scheduling, image pull and the disk are proven before the container is stopped; memory admission is only checked when the machine starts, so a machine refused then is still before the point of no return.
- **Verified boot is the point of no return.** "Verified" means the guest answered and the runner reports its home was restored from exactly the seed the copy stored — the seed contract, not readiness alone. A boot that misses the seed goes back to copying on a fresh machine and counts as a copy attempt.
- **Abort** is valid in every phase before verified. It restores the snapshot, deletes the machine and its seed, and leaves the old volumes as they were, still labelled as the Agent's, so the container resumes on them.
- **Bounded.** A migration fails for good after a fixed number of copy attempts or a wall-clock budget, with the reason on the Agent. From that state the user aborts or retries; a retry starts over from preflight with a new machine.
- **Status, not annotations.** Phase, reason and attempts are a status condition the controller writes. Annotations keep only the request and what the controller must re-read after a restart.

## Alternatives Considered

- **Controller writes `spec.backend` after the verified boot** — breaks the rule that the api-server is the only spec writer, which is what keeps the spec/status split free of write races.
- **Flip first and keep a snapshot for abort** — the container side stops being reconciled at the flip, so preflight would run with no workload to fall back to, and every abort would be a spec rewrite back across a Backend change.
- **Explicit migration request field in the spec** — needs a CRD change and a second reader of the same intent as the annotations the controller already resumes from, for no new behaviour.

## Consequences

- **Easier:** an unschedulable runner, an unpullable image or a disk that does not fit now fail while the container is still serving, instead of after its StatefulSet is gone (the case that previously needed hand recovery).
- **Easier:** a stuck copy stops after three attempts instead of retrying every ten minutes without end, and the user can go back without an operator.
- **Harder:** the switch takes one more hop — the api-server polls for verified Agents — so a migration settles up to one poll interval after the guest answers.
- **Harder:** the controller reconciles one Agent on both backends at once during a migration, so the container reconcile has to leave the Service and volumes alone while the machine is prepared.
- **Committed-to:** the old volumes are released, relabelled and retained only after the switch. Until then abort depends on them keeping their agent and mount labels.
