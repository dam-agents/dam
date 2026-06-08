# ADR-061: Warm PVC pool for instant agent workspace provisioning

**Date:** 2026-06-08
**Status:** Accepted
**Owner:** @pilartomas

## Context

An agent's workspace volume is provisioned dynamically on first start. In production this takes anywhere from tens of seconds to several minutes — dead time the user waits through before the agent is usable, and the slowest, most visible step of bringing a new agent online. Nothing provisions storage ahead of demand.

## Decision

The controller maintains an operator-tunable buffer of pre-provisioned, already-bound spare workspace volumes, keyed by size; a newly created agent claims a matching spare at create time instead of waiting for dynamic provisioning. When no spare matches, it falls back to dynamic provisioning so creation never blocks.

Rules and boundaries:

- The buffer is a set of **size-keyed pools** — each holds a target number of ready spares of one workspace size. A persisted mount claims from the pool whose size matches its effective size; a size with no configured pool falls back.
- Spares are provisioned **ahead of demand**, which requires a storage class that allocates storage when the claim is created (immediate binding). The agents' own class defers allocation until a pod mounts the claim, so a spare there would hold no storage and the buffer would save nothing; the pool therefore uses a distinct immediate-binding class. Only the storage class differs from live agents — the pool inherits the cluster's single workspace access mode (read-write-many, so a fork can co-mount the volume), never a separate setting that could silently drift.
- The claim is decided **once, at first create**, and reproduced on every later reconcile from the agent's already-created StatefulSet (the frozen record of which mounts are claimed vs dynamically provisioned), so the agent renders identically across hibernate/wake — a claim is never introduced into, or dropped from, an already-created agent.
- A **workspace volume is identified by label** (owning agent + mount), not by a reconstructed name. A claimed spare keeps the pool's generated name, so consumers that previously derived a volume's name by convention — forks co-mounting the parent's workspace — now resolve by label, with a legacy name-convention fallback for volumes created before the label existed.
- Claiming is a single atomic relabel of an **unclaimed** spare (optimistic-concurrency; a lost race retries the next spare, and agent reconciles are serialized), so two agents can never claim the same volume and no agent can take a volume already owned by another — ownership is the controller-set agent label, never a user-chosen name.
- A claimed spare becomes an **ordinary agent workspace volume**: reattached on wake, and **destroyed on agent deletion — never recycled into the pool.** A used workspace is adversarial input ([persistence](../architecture/persistence.md) security boundary); reuse across agents would leak data and the re-provisioning it saves is exactly the latency the pool already hides off the critical path.
- A spare stuck provisioning past an operator-tunable bound is reclaimed, so a broken class or blown quota can't permanently starve refills; the bound sits well above worst-case healthy provisioning so a slow-but-healthy spare is never reaped.
- This targets the current persistent-StatefulSet model. It is orthogonal to the single-use-Job target ([ADR-012](012-runtime-lifetime.md)), which may keep or drop the pool independently.

## Alternatives Considered

- **Dynamic provisioning only (status quo)** — leaves first-start latency unbounded at tens of seconds to minutes.
- **Pre-create claims on the agents' deferred-binding class** — a claim there provisions nothing until a pod mounts it, so a pre-created one stays empty and saves nothing.
- **Prime deferred-binding claims with throwaway pods** — adds pod lifecycle and a per-volume warm-up cost to achieve what an immediate-binding class does on creation.
- **Pool of hot standby agent pods** — far heavier; reserves compute and per-agent identity to solve a storage-latency problem.

## Consequences

- **Easier:** when a spare matches, new-agent start drops from the measured tens-of-seconds-to-minutes provisioning wait to claiming and mounting an already-bound volume.
- **Harder:** the deployment must supply an immediate-binding RWX storage class distinct from the agents' deferred-binding class; idle spares hold real provisioned storage (a standing cost) until claimed or trimmed; the claim decision must be reproduced byte-identically on each reconcile or the agent's pod template drifts from the live object; the claim is taken at create, so a hibernated or schedule-only agent holds a spare from creation, draining the buffer ahead of any interactive start.
- **Committed-to:** a spare carries no owning-agent label until it is claimed, so the orphan-volume sweep skips it — that sweep's "no agent label → leave alone" rule is now load-bearing, and broadening it to match unclaimed spares would delete the buffer. Workspace volumes are addressed by label, not by name; the fork's former name-by-convention lookup is replaced, and its legacy name fallback stays load-bearing until every pre-label agent is gone.
