---
id: 080
title: Agent workspaces on ReadWriteOnce storage, migrated in place
status: accepted
subsystem: persistence
tags: [storage, pvc, nfs, migration, dam-run]
summary: Workspace volumes are ReadWriteOnce on ordinary storage; a controller-run, checksum-verified migration drains existing RWX volumes; the bundled NFS server is deprecated and dam-run is disabled until it has a non-shared-workspace model.
---

# ADR-080: Agent workspaces on ReadWriteOnce storage, migrated in place

**Date:** 2026-07-29
**Status:** Accepted
**Owner:** @jezekra1

## Context

Workspace volumes were ReadWriteMany because two features wrote into a live agent's workspace from a second pod: per-turn impersonation forks (removed by ADR-079) and `dam-run` executors. That single requirement made every install provision a shared filesystem — our own dev/test clusters only worked by bundling an NFS server whose upstream image is archived and breaks on btrfs hosts — and put every file operation of every agent on a network filesystem, whether or not the agent ever used either feature.

## Decision

Workspace volumes are ReadWriteOnce, structurally: the access mode is no longer configuration, and the agent pod is the volume's only writer. `dam-run` — the last second writer — is disabled (the relay refuses invocations; the machinery stays dormant) until it has a workspace model that doesn't need a shared volume; re-enabling is a code change, never a knob, because a knob would re-permit co-mounting that RWO storage only supports on a single node. Existing RWX volumes are drained by a controller-run migration: force the agent down (interrupting in-flight work by design), copy the quiesced volume onto a fresh RWO PVC in a Job, verify by checksum, re-point the agent through the same by-name claim mechanism the warm pool uses, delete the old volume on the strength of the verification, and restore the prior run state. Every step derives from cluster state, so the migration is safe to interrupt and resume, and an agent can never wake against a half-copied volume. The bundled NFS server is deprecated in place: installs whose volumes still live on it keep it enabled until the migration drains them, then disable it; the chart block is deleted in a later release.

## Alternatives Considered

- **Migrate on wake via an init container** — binds the new volume on the right node for free, but turns some user's first wake into a minutes-long copy and never reaches agents nobody wakes.
- **Live pre-copy + delta at flip** — minimizes per-agent downtime, but doubles the machinery for a window nobody asked to shrink (forced downtime during migration was accepted explicitly).
- **Wake each agent after migrating to confirm before deleting the old volume** — a fleet-wide wave of wakes for confirmation the checksum pass already provides.
- **Delete the bundled NFS server in the same release** — an in-place upgrade would kill the server while unmigrated volumes still live on it; the deprecation window is what makes the migration non-destructive.

## Consequences

- **Easier:** any cluster's default storage class now runs the platform — the dev/test VMs drop the NFS server, the NFS client packages, and the btrfs fallback; every agent's file IO moves from a userspace NFS hop to ordinary block storage.
- **Harder:** agents lose `dam-run` until it is redesigned (its fan-out contract explicitly promised many pods over one workspace); RWO pins a volume to one node's reach, so schedulers and the copy Job's placement now decide where an agent can run; migration forcibly interrupts running agents once each.
- **Committed-to:** single-writer workspaces as an invariant — any future feature that wants a second concurrent writer (executor pods, live workspace sharing) must bring its own access path (copy, network protocol, same-node affinity) rather than widening the volume's access mode.
