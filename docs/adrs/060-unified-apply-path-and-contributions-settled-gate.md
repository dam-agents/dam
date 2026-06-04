# ADR-060: Unified runtime-channel apply path + settlement tracking

**Date:** 2026-06-03
**Status:** Accepted
**Owner:** @janjeliga

Amends ADR-052, ADR-053. Builds on ADR-059.

## Context

Contributions are applied at connect time: a pod's `hello` carries the desired state back and the pod applies it, racing the background delivery worker — two appliers, no single write ordering. A failed Contribution has no path to retry or to surface, so it passes silently. And the worker dispatches `applyState` at whatever pod answers — including one that is down or mid-roll — half-landing work on a pod about to vanish.

## Decision

Apply Contributions out-of-band from a single background worker — the sole applier, so writes have one ordering. `hello` is presence-only: it signals the worker to dispatch, it does not carry or apply state.

- **Dispatch only to a Ready agent** — the controller-published `Ready` condition (ADR-059), the same signal the ACP relay's `ensureReady` gates on. Otherwise defer: the row stays unsettled and the sweep re-dispatches once the agent is Ready again. An apply to a down or rolling pod is never attempted.
- **Apply settles to completion.** Application runs every Contribution to termination and reports which ones failed. The *settled* cursor (`last_settled_version`, advanced on every terminated cycle) drives the retry — the sweep re-dispatches any version not yet settled, or settled-with-failures under the attempt cap. The *clean* cursor (`last_applied_version`, advanced only on a fully-clean settle) drives stale-detection and event dispatch. An agent can be settled-with-failures.
- **Don't block on failure; surface it.** One broken Contribution must not stall the others or wedge the agent; it runs degraded behind a badge that persists until a later attempt clears it. Clean and in-progress work stay silent.
- **Readiness is unchanged.** Contributions apply in the background; the `Ready` condition (ADR-059) does not wait on them. Gating readiness on Contributions Settled is deferred.
- **Status reads are fail-soft.** A transient failure of the settle/fail store defaults to "settled" (no badge) and never fails a pod-backed read.

## Alternatives Considered

- **`hello` carries state / multiple appliers** — races connect-time application against the worker; a single applier gives one write ordering.
- **Apply blindly and rely on the agent rejecting it** — wastes an attempt against a dying pod and depends on the agent's behaviour mid-shutdown; a cheap pre-dispatch Ready check in the worker (the same `isReady` the relay uses) defers instead, and the sweep retries.
- **A pod-side SIGTERM drain that refuses applies while shutting down** — closes a sub-second race the worker's pre-check can't, but adds drain machinery to the agent-runtime; reacting via the worker's Ready check + settle/retry covers the dominant case, and a cut apply replays safely.
- **Abort application on the first failure** — one broken Contribution would block every other and stall the retry indefinitely.
- **Anticipate the env-roll by stamping the desired revision on the pod and gating on a match** — handles only the environment-change cause, not eviction, drain, or restart; reacting via retry covers every cause.
- **Detect a roll in progress from StatefulSet revision or node conditions** — deferred: widens the api-server's cluster-read surface and duplicates the controller's roll logic; reacting to the controller's `Ready` condition covers the dominant case.

## Consequences

- **Easier:** a pod roll from any cause (env change, eviction, drain, restart) is absorbed by retry against the new pod — never half-landed on a leaving one — and reconfiguring applies in the background without racing a connect-time applier.
- **Easier:** a failing Contribution can't wedge the agent or pass unseen; it runs degraded behind a badge while the rest install.
- **Harder:** the badge depends on the settle/fail store being readable; the read is fail-soft (defaults to no badge), so a store outage can briefly hide a genuine failure.
- **Committed-to:** one applier, one write ordering; the api-server owns the durable settle/fail record, persisted as agent status until resolved.

## Amends

- **ADR-052** — the "interchangeable delivery routes" framing no longer holds; a pod's connect is presence-only.
- **ADR-053** — state is applied only from the worker, not at connect time.

Builds on **ADR-059** — readiness is the controller-published `Ready` condition; the worker gates dispatch on it (`isReady`) and does not change it. Gating readiness on Contributions Settled is deferred.
