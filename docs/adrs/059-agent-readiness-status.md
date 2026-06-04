# ADR-059: Agent readiness is controller-computed status — agent ∧ gateway

**Date:** 2026-06-03
**Status:** Accepted
**Owner:** @jezekra1

## Context

[ADR-032](032-pod-reachability-primitive.md) made the *live, observed agent-pod `Ready` condition* the source of truth for "can I call this pod?" via a hot-path `ensureReady` probe, and explicitly **deferred** a reconciler-maintained lifecycle state as "valuable later … can be layered on top." Two things now force that "later": [ADR-058](058-crds-over-configmaps.md) gives the Agent a real status subresource and eliminates `desiredState`, and ADR-032's probe observes **only the agent pod** — an agent whose paired gateway pod ([ADR-038](038-paired-gateway-pod.md)) is NotReady has no credentialed egress yet still reads as `Ready`. (ADR-032 is itself still Proposed and owned by @janjeliga — coordinate.)

## Decision

**The controller computes Agent readiness as the intersection of the agent and gateway pod `Ready` conditions — each gated on the pod being current to its StatefulSet's latest rolled-out revision — and publishes it on the Agent status subresource; the api-server reads that condition as the *sole* routing signal and never touches pods.**

- `Ready` is the agent-and-gateway intersection: both pods of the pair must be Ready. The controller is the sole computor — it is the only component that already observes both pods of the pair.
- Readiness reflects the *observed rollout*, not an instantaneous pod check: a pod counts only when it is Ready **and** on the latest revision its StatefulSet has rolled out. A still-Ready pod that a pending change — restart, spec edit, credential set — is about to replace reads as not-ready, so readiness never flashes to Ready on a soon-to-be-replaced pod. The controller keeps no rollout state of its own; it compares live-read, Kubernetes-maintained revision fields.
- Conditions are the source of truth (`Ready`, `AgentPodReady`, `GatewayPodReady`, `Reconciled`). The status phase is a derived, non-authoritative human summary; no machine consumer branches on it.
- The api-server's readiness/wake path becomes "poke (bump activity) → wait for `Ready`", with **no pod access in the api-server at all**: an absent or False `Ready` condition means not-ready, full stop. There is no live-probe fallback — the controller is the single source of readiness, so the api-server's pod-read primitive and its pod RBAC are removed entirely. This composes with the activity-driven wake from ADR-058.

## Alternatives Considered

- **Keep ADR-032's live agent-pod check** — misses the gateway dimension; the api-server cannot cheaply observe the paired gateway, so a "Ready" agent can still fail credentialed egress.
- **api-server probes both pods itself** — duplicates pod-pairing logic in the api-server and adds a second hot-path probe; the controller already watches both pods.
- **A single `phase` enum as the source of truth** — discouraged by K8s API conventions, not extensible, and conflates run intent (Running/Hibernated) with operational readiness, which are orthogonal axes.
- **Keep ADR-032's live-probe as an api-server staleness fallback** — retains pod-pairing logic and pod RBAC in the api-server to cover controller lag; rejected because the pod-informer-driven status makes that lag window vanishingly small, and the least-privilege win of zero api-server pod access outweighs guarding an edge the platform has not observed. The fallback was specified in the original draft and removed during implementation.

## Consequences

- **Easier:** the api-server reads one field and drops **all** pod access — its pod-probe primitive and pod RBAC are gone, shrinking its footprint to Secrets + the Agent/Fork CRs + PVC cleanup (least privilege); readiness accounts for the gateway *and* rollout state, so it never reports Ready against a pod with no credentialed egress or one mid-replacement; `kubectl get agents` and the UI gain a real readiness column sourced from one place.
- **Harder:** the controller must watch both pods' `Ready` transitions and write status promptly — a pod-informer path and more frequent status writes than spec-driven reconciliation alone; readiness is eventually consistent with **no** api-server fallback, so a stalled controller strands callers on stale readiness — accepted because the pod-informer path is prompt and the api-server has no cheap way to observe the paired gateway anyway.
- **Committed-to:** the controller is the *sole* source of agent readiness — there is no fallback; any future need for sub-controller-latency readiness must make the controller prompter, never reintroduce an api-server pod probe; "observed agent-pod Ready is the truth" (ADR-032) is replaced by "controller-computed agent ∧ gateway readiness, gated on the rolled-out revision, is the truth."

## Supersedes

- **ADR-032** (pod-reachability primitive) — fully superseded: the `ensureReady` pod-probe is removed from the api-server, not retained as a fallback. The authoritative — and only — readiness signal is controller-computed status, which now includes the gateway and the rolled-out revision. ADR-032's rationale is retained for historical reading.
