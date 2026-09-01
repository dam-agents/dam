---
id: 086
title: Pod-owned live updates over the agent's own tRPC surface
status: accepted
subsystem: platform-topology
tags: [live-updates, sessions, workspace, acp, hibernation]
summary: Pod-owned state is read and watched over the agent-runtime's own tRPC surface relayed over WebSocket; a Watch lives only as long as its subscriber and emits topic-plus-ids notices, never state.
---

# ADR-086: Pod-owned live updates over the agent's own tRPC surface

**Date:** 2026-08-25
**Status:** Accepted
**Owner:** @jezekra1

## Context

The live-updates work ([ADR-083](083-eventing-layering.md)) replaced polling with pushed invalidation notices everywhere the api-server could observe the write. Two surfaces stayed on timers because their truth lives inside the pod: the session list at five seconds, and the workspace listing plus the open file at two seconds each. Three things since have made that residue expensive rather than merely untidy. The file panel's readiness check runs on every proxied call and patches the Agent record each time, and once the controller stopped reconciling on every resync that patch storm became the dominant steady-state reconcile load, sitting in front of the readiness-latency work the resync change was a prerequisite for. A new Home feed polls the session list for every running agent, opening and closing a WebSocket per agent per tick — the cross-agent session listing [ADR-055](055-agent-owned-session-metadata.md) assumed did not exist. And the session list is reached by opening a throwaway ACP connection purely to carry one read.

## Decision

Pod-owned state — the session list, the workspace directories a client has open, and the open file — is read and observed over the agent-runtime's own tRPC surface, exposed over WebSocket and relayed by the api-server, rather than over ACP or on a timer. A **Watch** exists only while a subscriber is attached and emits notices carrying a topic and ids, never state, so an unobserved agent produces no traffic.

The rules this sets:

- **A notice means "re-read", never "here is the value."** Every consumer must have a query path. This holds even for liveness: a terminal session's working state has no falling edge to push, so the pod times it out and emits a notice like any other change.
- **Sync-on-subscribe is the whole loss bound.** Every subscription opens with a notice meaning "re-read everything you map", and there is no steady-state poll behind it. A dropped connection, a pod restart and a hibernate-wake cycle all heal the same way.
- **The harness stays authoritative over which sessions exist.** The platform composes its view by union and enrichment, never by maintaining a competing list. Session creation stays on ACP, because the harness mints the id.
- **A workspace Watch covers exactly the directories a client has open, non-recursively.** How it detects change is private to the pod, so storage without filesystem notification degrades internally rather than on the wire.
- **Owner-wide observation is a distinct subscription whose existence is the signal.** It cannot ride the per-owner notice stream, which takes no input and which every tab mounts unconditionally. A demand-driven holder on each subscriber's own replica keeps pod-facing connections bounded by running agents rather than by tabs — deliberately unleased, because the demand signal is local to the replica the tab connected to, so a leased holder would starve subscribers elsewhere, and duplication across replicas is a redundant socket carrying idempotent notices. Exactly-once arrives with the first holder that persists state.
- **Watching does not keep an agent alive; being used does.** A user-facing relay checks readiness passively, takes no session pin, and refreshes the activity stamp periodically while open. Server-held streams refresh nothing — they exist for every running agent of every watching owner, and a stamp from one would pin the fleet awake.

## Consequences

- **Easier:** every fixed-interval poll against a pod goes away — the five-second session list, both two-second file polls, and the Home feed's one-WebSocket-per-running-agent tick. Activity stamping drops from once per proxied call, currently around thirty Agent-record patches a minute per open file panel, to one per open view per interval, and the controller's full reconcile per patch goes with it.
- **Easier:** composing the session list inside the pod closes a gap ADR-055 promised and never implemented — sessions present in the pod's own store but not yet in the harness's are never listed today, which is why a schedule-fired session is absent rather than merely late.
- **Harder:** two readers still take the ACP path — channel workers open a client per turn to match a thread, and the CLI has its own — so the response intercept survives until they migrate, leaving two compositions of one view in the interim. That is the divergence ADR-055 was written to remove, reintroduced with a different seam.
- **Harder:** removing the steady-state poll removes the net that hid a broken notice path. A lost notice now shows as a stale panel until the next subscribe. This is deliberate — a slow fallback would have kept such a bug invisible — but it moves the failure from degraded to wrong.
- **Harder:** a per-agent WebSocket relay is a fourth relay to admit, authorize and audit, on a surface whose existing three each carry their own activity and pin semantics. The new one needs a third policy, distinct from both.
- **Committed-to:** the pod's own tRPC surface, not ACP, is where platform-owned session reads live. A Watch's lifetime is its subscription, which is the only thing making "unobserved agent, no traffic" true rather than aspirational. And notices never carry state, so any future consumer must bring a query path rather than treating the stream as a feed.

## Alternatives Considered

- **ACP notifications on the connection a tab already holds** — pod-to-client notices already exist there, but a filesystem watch is not an ACP concern, and it would leave the UI with two unrelated notification mechanisms.
- **Reporting to the harness port and projecting into the per-owner notice stream** — that port refuses WebSocket upgrades and exposes one route, and "is anyone watching" becomes a cross-replica reference count pushed back down to the pod.
- **A new topic on the existing per-owner notice stream** — it takes no input, so a watch set has nowhere to live, and every tab subscribes unconditionally, so watches could not be scoped to observers.
- **Server-sent events through the existing HTTP proxy** — the proxy forwards no abort signal, so a closed tab leaves the pod watching, and a reconnect against a hibernating agent wakes it through the per-call readiness check.
- **A server-side session projection so hibernated agents appear in the feed** — deferred, not rejected: the Home work documents that limitation as deliberate, with tracking read state server-side named as its own decision.
- **Keeping a slow poll as the loss bound** — converges no faster than sync-on-subscribe and masks a broken notice path, which is the failure mode hardest to notice.

## Amends

- **ADR-055** — its committed-to clause naming `_meta.platform.*` as the wire format narrows to writes. That choice rested on every reader already holding an ACP connection; a per-agent tRPC relay makes the premise false. The agent remains the sole source of truth for session existence and metadata, and there is still no server-side session store.
- **ADR-049** — its committed-to "per-directory cache keying as the unit of subscription; any future shift from polling to push delivery will reuse this shape" is honored rather than changed: a Watch covers exactly the open directories, and the set a client declares is the same one it already sends to read them.
- **ADR-083** — unchanged in layering, extended in origin. An invalidation notice may now originate in a pod rather than only from a domain event inside the api-server. Thin, advisory, schema-parsed on receipt, and loss bounded by reconciliation all still hold.
