# ADR-059: Agent readiness is controller-computed status — agent ∧ gateway

**Date:** 2026-06-03
**Status:** Proposed
**Owner:** @jezekra1

## Context

[ADR-032](032-pod-reachability-primitive.md) made the *live, observed agent-pod `Ready` condition* the source of truth for "can I call this pod?" via a hot-path `ensureReady` probe, and explicitly **deferred** a reconciler-maintained lifecycle state as "valuable later … can be layered on top." Two things now force that "later": [ADR-058](058-crds-over-configmaps.md) gives the Agent a real status subresource and eliminates `desiredState`, and ADR-032's probe observes **only the agent pod** — an agent whose paired gateway pod ([ADR-038](038-paired-gateway-pod.md)) is NotReady has no credentialed egress yet still reads as `Ready`. (ADR-032 is itself still Proposed and owned by @janjeliga — coordinate.)

## Decision

**The controller computes Agent readiness as the intersection of the agent and gateway pod `Ready` conditions and publishes it on the Agent status subresource; the api-server reads that condition as the authoritative routing signal instead of probing pods itself.**

- `Ready` is the agent-and-gateway intersection: both pods of the pair must be Ready. The controller is the sole computor — it is the only component that already observes both pods of the pair.
- Conditions are the source of truth (`Ready`, `AgentPodReady`, `GatewayPodReady`, `Reconciled`). The status phase is a derived, non-authoritative human summary; no machine consumer branches on it.
- The api-server's readiness/wake path becomes "poke (bump activity) → wait for `Ready`", with **no pod probing in the api-server**. This composes with the activity-driven wake from ADR-058.
- Because the published condition is eventually consistent, the api-server keeps a **live-probe fallback** when the condition is stale relative to the controller's observed generation, preserving ADR-032's freshness guarantee against a lagging controller.

## Alternatives Considered

- **Keep ADR-032's live agent-pod check** — misses the gateway dimension; the api-server cannot cheaply observe the paired gateway, so a "Ready" agent can still fail credentialed egress.
- **api-server probes both pods itself** — duplicates pod-pairing logic in the api-server and adds a second hot-path probe; the controller already watches both pods.
- **A single `phase` enum as the source of truth** — discouraged by K8s API conventions, not extensible, and conflates run intent (Running/Hibernated) with operational readiness, which are orthogonal axes.
- **No freshness fallback — trust status unconditionally** — a stalled controller would strand every caller on stale readiness; ADR-032 chose live observation precisely to avoid that failure mode.

## Consequences

- **Easier:** the api-server reads one field and deletes its pod-probe primitive; readiness finally accounts for the gateway, so credentialed egress can no longer fail against an agent the platform reported Ready; `kubectl get agents` and the UI gain a real readiness column sourced from one place.
- **Harder:** the controller must watch both pods' `Ready` transitions and write status promptly — a new pod-informer path and more frequent status writes than spec-driven reconciliation alone; readiness becomes eventually consistent, so the api-server must carry the staleness fallback to match the freshness ADR-032 had for free.
- **Committed-to:** the controller is the single computor of agent readiness; if any caller ever needs sub-controller-latency readiness it must use the live fallback rather than reintroducing its own probe; "observed agent-pod Ready is the truth" (ADR-032) is replaced by "controller-computed agent ∧ gateway readiness is the truth."

## Supersedes

- **ADR-032** (pod-reachability primitive) — the `ensureReady` contract is preserved as the api-server's *fallback*, but the authoritative readiness signal moves to controller-computed status and now includes the gateway. ADR-032's rationale is retained for historical reading.
