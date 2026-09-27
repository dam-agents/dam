---
title: smolvm microVMs are the only agent runtime
status: proposed
subsystem: vm-runner
tags: [vm, smolvm, gateway, quota, migration]
summary: Every agent becomes a smolvm machine in its owner's runner pod, with a per-owner CPU and storage pool and the owner's gateway as a sidecar there; container agent pods and Kata are removed once every agent has been migrated with its HOME.
---

# ADR: smolvm microVMs are the only agent runtime

**Date:** 2026-09-27
**Status:** Proposed
**Owner:** @JanPokorny

## Context

Two agent Backends run side by side: a pod per agent (optionally under Kata) and the vm Backend, where an owner's machines live in one runner pod. Every feature that touches an agent carries both paths. The vm Backend is still opt-in behind a per-user experimental flag. GPU templates, per-template node placement and persisted paths outside HOME are the only things it cannot do, and none of them is used in practice. A review of the vm Backend found its remaining gaps fixable; none of them argues for keeping two runtimes.

## Decision

smolvm microVMs become the platform's only agent runtime. Each owner gets one runner pod that hosts all of their machines, a shared pool of CPU and storage, and one gateway as a sidecar. Container agent pods and Kata are removed once every existing agent has been migrated, with its HOME moved into its VM disk.

- **One runtime.** The per-agent pod goes, and with it Kata (`runtimeClassName`), per-template node selection, GPU and other extended resources, and persisted paths outside HOME. HOME on the machine's disk is the one persistence rule.
- **The move.** An agent moves on its own Backend: its identity, sessions and schedules stay, and its HOME is copied into its disk. Data on any other persisted path is copied under HOME, so the one persistence rule holds after the move. The old volume is kept for a retention window, so a move can be rolled back onto it.
- **Transition in four phases**, each one proving the next:
  1. *Opt-in.* A user who opts into the experiment gets the new runtime for new agents and a button that migrates one chosen agent. Every move is started by hand, so the whole path is tested one agent at a time.
  2. *New runtime for everyone.* The experiment and its flag are removed, and the runtime is presented as the new runtime, not an experiment. New agents are machines; existing agents still move only when their user presses the button.
  3. *Platform-driven migration.* The platform moves the remaining agents itself, in phased batches.
  4. *Removal.* Once every agent has moved, the container Backend, Kata with it, the migration and the button are deleted.
- **Per-owner runner.** The runner pod stays the unit of placement, failure and trust. All of an owner's machines share it, and a guest escape reaches that owner and no one else.
- **Per-owner gateway in the runner pod.** One gateway per owner runs as a sidecar of the runner and serves all of that owner's machines, replacing the pod per agent.
- **Per-owner pool for CPU and storage.** The runner's CPU limit is the owner's quota, and a machine may use CPUs up to it. Each machine keeps one sparse disk, sized up to the pool. The guest discards freed blocks, and the runner stops a machine before the owner's claim fills. Memory stays sized per agent for now.
- **smolvm is carried, not forked.** The pin moves to the latest release, and an in-repo, verified patch set sits on it: a journal on storage disks, never formatting a disk that holds data, SIGTERM to the workload on stop, and discard.
- **Local development** keeps nested virtualisation in lima, which limits it to Macs that support it (M3 and later). A single runner on the macOS host is a follow-up.

## Alternatives Considered

- **Keep both Backends** — every agent feature keeps two implementations, for configurations nobody uses.
- **Migrate every agent in the first release** — the move would run at scale before it had been tested on single agents, one chosen by hand at a time.
- **Runner per node** — a guest escape would reach every owner on the node, and a per-owner pool would become a scheduler problem.
- **Runner per agent** — no shared pool, and the most pods, which is what the pod per agent costs today.
- **Gateway per agent, in its own pod** — keeps raw credentials out of the runner, at one extra pod per agent.
- **Shared all-owner gateway Deployment** — independent lifecycle, but needs per-request caller identity asserted by the runners, too large a change to make alongside the cutover.
- **Pool memory now** — overcommit needs a runner-side pressure controller, and an owner's runner that runs out of memory is OOM-killed with every machine it hosts.
- **HOME on virtiofs** — container runtimes inside the guest cannot keep their layers on it.
- **Upstream-only smolvm fixes** — data-loss fixes would wait on a single-maintainer project's releases.
- **Fork smolvm** — we would own a young VMM outright.

## Consequences

- **Easier:**
  - One agent lifecycle. The reconciler, persistence, storage migration and UI lose their per-Backend branches.
  - A gateway change no longer needs a pod per agent: the owner's gateway follows the runner's roll.
  - A user sees one CPU and storage budget rather than per-agent sizes that add up to it.
  - Container runtimes and clusters run inside every agent, which a pod could not host.
- **Harder:**
  - Every node that hosts agents needs KVM. That means bare metal or nested virtualisation, a device plugin, and CI runners with `/dev/kvm`.
  - Local development runs only on Macs with nested virtualisation until the host runner exists.
  - A VM escape now yields the owner's raw credentials, since the gateway shares the runner pod. An agent can use connections granted to its sibling agents.
  - A runner restart reboots every agent of that owner, and all of an owner's running agents must fit on one node.
  - The patch set must be rebased on every smolvm bump.
- **Committed-to:**
  - smolvm and its KVM requirement as the only agent runtime.
  - The runner pod as the per-owner boundary for placement, failure, credentials and quota.
  - The patch set until upstream carries its fixes.
