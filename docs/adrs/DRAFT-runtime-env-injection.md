# ADR-DRAFT: Credential env via the runtime channel — injected at harness spawn, not baked into the pod

**Date:** 2026-06-04
**Status:** Proposed
**Owner:** @janjeliga

## Context

Credential env reaches an agent only by being baked into its pod spec. A running pod's environment is immutable, so every change to the granted set rolls the pod — ADR-040 codified this as unavoidable ("there is no hot path"). The costs: a freshly created agent restarts itself the moment its initial grants land, and any mid-life grant change drops the running agent's in-flight sessions.

The env the agent holds is only *placeholders* — the real credential is injected at the gateway on the wire (ADR-005/033/038). The pod is already untrusted and holds no secret bytes, so moving where placeholders are delivered does not touch the credential boundary. That is what makes a non-pod delivery path viable.

## Decision

**Credential-placeholder env is delivered as a contribution on the runtime channel (ADR-052) and merged into the harness process environment at spawn, not baked into the pod spec. The agent pod template becomes independent of the granted set — no grant or credential-env change rolls it.**

- **Env is a contribution kind.** It rides the same channel, snapshot reconciliation, and acknowledgement model as the other contributions (ADR-051), persisted on the agent's volume — no separate transport.
- **Injection is at spawn.** Reconciled env is composed into the harness process environment and inherited by its tool subprocesses; a running process's environment is never mutated. User-supplied env still wins on collision (ADR-040).
- **Mid-life changes respawn the harness, not roll the pod.** The harness is long-lived and reused across turns, so it needs a respawn to pick up new env — taken at an idle turn boundary, forced after a bound if the agent never idles. Agent-owned resumable sessions (ADR-055) absorb it, and even a forced respawn restarts only the harness — strictly less disruptive than the whole-pod roll it replaces.
- **First spawn waits for the first delivery, then falls back to best-effort.** On a cold start the spawn is held until the channel delivers env once, so the first turn has credentials; the hold is bounded and in-pod, not a readiness gate. If delivery never lands within the bound the harness spawns anyway and the respawn-on-change path heals it.
- **An open interactive terminal is not disturbed** by a mid-life change — it picks up new env only on its next spawn. Refreshing it would destroy the live session; a recorded limitation.
- **The agent pod template is decoupled from the granted set.** With env gone, its only remaining grant-derived input was the `ca.crt` mount (the cluster MITM CA). The controller now always issues the per-agent leaf cert and the agent mounts `ca.crt` unconditionally, so the mounted bytes never change with the grant set and granting the first credential no longer rolls the pod. Only the *gateway* pod still re-renders its filter chains (out of scope, ADR-038).
- **Forks keep env baked into their pod spec.** A fork is an ephemeral one-task pod that never rolls mid-life and draws placeholders from the foreign replier's secrets, not a grant set; the channel's async first-spawn window buys it nothing and is riskier for a one-shot pod. The in-pod mechanism is shared — only the placeholder origin differs.

## Alternatives Considered

- **Single-shot create** — *adopted as a create-time optimisation, not the roll fix.* Settling the initial secret/connection selection into the Agent spec before the first reconcile lets the gateway render its chains once (no readiness flap) and the credentials ride the agent's first snapshot. The pod is grant-independent regardless; this only helps create-time credentials.
- **Hot-reload env on the running pod** — impossible; pod env is immutable (the ADR-040 premise).
- **Mutate the runtime process's own env and rely on inheritance** — not durable across a pod restart, risks clobbering platform env; rejected.
- **Deliver env as a file the harness reads** — the harness consumes a real process environment, forcing a per-harness-image change; rejected.

## Consequences

- **Easier:** Grant and secret-env changes no longer roll the agent pod, so a running agent's sessions survive a credential edit that today drops them, and a new agent no longer self-restarts when its initial grants land. The change also stops flipping the agent to not-ready under ADR-059's revision-gated readiness.
- **Easier:** Env joins the one reconciliation-and-settlement path the other contributions use — adding or removing a credential is a data change, not a pod lifecycle event.
- **Harder:** Delivery is asynchronous, so "pod ready" no longer implies "credentials present" — and any signal that infers credential-presence from startup env inherits a first-spawn window where it reads "not yet known," not "absent." The cold-start spawn-hold covers the common case; ADR-059 readiness is gated on the rolled-out revision and channel env participates in no revision, so making readiness wait for env would need a delivered-signal no path tracks today. (Forks, which keep baked env, are unaffected.)
- **Harder:** The env-change lifecycle moves from Kubernetes (change spec → roll) into platform runtime code (detect change → respawn at an idle boundary, force after a bound). It reuses existing spawn and session-idle tracking, so the addition is small, but it is now platform code rather than a K8s guarantee.
- **Harder:** Keeping the template grant-independent means always issuing the leaf cert, so every agent — even a credential-less one — depends on cert-manager minting it before the pod starts and carries a leaf Secret it may never use. A one-time start dependency, not a recurring cost.
- **Harder:** Env now reaches only a harness that advertises the capability to consume it; one that predates this starts credential-less rather than failing loud. Delivery rests on harness capability where the pod spec was unconditional — tolerable because harness and delivery path ship together.
- **Committed-to:** The runtime channel is the sole delivery path for credential env; the pod spec is no longer a source of grant-derived env. Reverting means re-coupling the two. Credential env now follows the channel's projected-state model and inherits its repair/staleness behaviour rather than being recomputed by the controller at every render.

## Related ADRs

- [ADR-040](040-unified-secret-contributions.md) — amends its premise that credential env must live in the pod spec and roll on change; its unified fanout and user-wins precedence are retained.
- [ADR-052](052-runtime-channel.md) / [ADR-051](051-connections-and-contributions.md) — env becomes one more contribution kind on the channel and model they define.
- [ADR-058](058-crds-over-configmaps.md) — grant intent (`grantedSecretIds`/`grantedConnectionIds`) lives in the typed Agent spec it introduced; this decision moves env delivery off the rendered pod spec onto the channel.
- [ADR-059](059-agent-readiness-status.md) — revision-gated readiness does not wait for channel-delivered env (see Consequences).
- [ADR-005](005-credential-gateway.md) / [ADR-033](033-envoy-credential-gateway.md) / [ADR-038](038-paired-gateway-pod.md) — the credential boundary and on-the-wire injection are unchanged.
- [ADR-055](055-agent-owned-session-metadata.md) — resumable, agent-owned sessions are what make harness respawn tolerable.
