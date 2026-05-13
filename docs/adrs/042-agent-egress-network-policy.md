# ADR-042: Agent egress is gated by NetworkPolicy; the agent is not a mesh participant

**Date:** 2026-05-13
**Status:** Accepted
**Owner:** @pilartomas

## Context

The agent pod runs LLM-driven, attacker-controlled code. Its only legitimate
intra-cluster destination is the paired gateway pod, which holds credentials
and gates outbound traffic through Envoy's `ext_authz` filter
([ADR-035](035-unified-hitl-ux.md)). Every other in-cluster destination —
Postgres, Redis, Keycloak, the api-server's harness and ext-authz ports,
another instance's gateway — must be structurally unreachable from the agent.

In an ambient Istio mesh, `istio-cni` installs an iptables redirect that
rewrites the agent pod's outbound destination to `ztunnel:15008` before the
kernel NetworkPolicy filter evaluates the packet. NetworkPolicy can therefore
enforce only "the agent may speak HBONE to ztunnel" — not which destination
that HBONE tunnel actually carries. Pair-isolation via NP becomes a polite
suggestion: any in-mesh workload without an explicit deny is reachable.

Replacing NP with Istio AuthorizationPolicy as the primary control was
considered ([ADR-041](041-istio-ambient-mesh.md) moves in that direction).
The attempt revealed that ambient policy attachment semantics are not
reliably auditable: `targetRefs: Service` requires the Service to be
bound to a waypoint or the policy silently no-ops with `AncestorNotBound`;
no-selector ALLOWs attach to neighbouring workloads in non-obvious ways and
switch their default to DENY at L4; ztunnel xDS state can resist policy
edits with no diagnostic beyond TCP refused. Putting a security guarantee
on every in-mesh destination via mesh AuthZ requires fanning ALLOWs across
the cluster and trusting they all converge — a worse cost-benefit than
admitting that the agent does not need to be in the mesh at all.

## Decision

Take the agent pod out of the mesh; let the kernel NetworkPolicy do the
job it was designed for.

- **Agent pod opts out of ambient.** Pod label
  `istio.io/dataplane-mode: none` removes the ztunnel redirect. The agent
  has no SPIFFE workload identity; its outbound packets show the real
  destination to NetworkPolicy.
- **Per-pair `<id>-agent-egress` NetworkPolicy.** Two egress rules:
  DNS to `kube-system` and the paired gateway pod (`pair=<id>,
  role=gateway`) on the Envoy proxy port. HBONE 15008 is not admitted;
  the agent never speaks it.
- **Gateway pod stays in ambient.** Its SPIFFE principal continues to
  gate the gateway → harness and gateway → ext-authz hops via the
  existing per-instance harness-allow and ext-authz-allow
  AuthorizationPolicies. The gateway's `ext_authz` filter remains the
  egress gate for everything the agent tunnels through it.
- **No NetworkPolicies on release-namespace destinations.** Postgres,
  Redis, Keycloak, the harness Service, the ext-authz Service stay
  unguarded by NP; the agent has no admitted route to any of them.

The `<id>-gateway-allow` AuthorizationPolicy is retired. With the agent
out of the mesh, the agent has no SPIFFE principal for an ALLOW policy
to match. The gateway pod has no ALLOW policy attached, so the mesh
default-allow applies and ztunnel passes the agent's plaintext
connection through to Envoy. The NetworkPolicy is the sole gate on that
hop.

## Alternatives considered

**AuthorizationPolicy as primary intra-cluster control.** Add a
release-namespace default-deny baseline plus per-instance ALLOWs at
every destination the gateway dials, and an egress waypoint that
captures source-side traffic from the agent namespace. Wins: a uniform
identity story, mesh-keyed audit. Rejected: ambient policy attachment
semantics differ across L4 vs L7 and across Gateway / Service /
no-selector targets in ways that fail silently when the policy doesn't
attach as intended. The failure mode is TCP-refused with no diagnostic,
and re-running `kubectl apply` does not always converge — ztunnel
caches xDS state that survives policy edits. A security guarantee that
hinges on every ALLOW attaching to the right resource is brittle.

**Both pods out of mesh.** Take the gateway out of ambient too. Wins:
no mesh participation anywhere, simpler. Rejected: the gateway →
harness and gateway → ext-authz hops would lose SPIFFE attribution and
need a substitute identity primitive (Bearer token, `:authority`-based
identity at the harness end, or per-gateway mTLS with platform-managed
certs). The gateway-side identity wiring already works; discarding it
to fix an agent-side problem is unjustified.

**NetworkPolicies on every release-namespace destination.** Lock down
each pod the agent must not reach. Rejected: the controller would
own a growing inventory of "which destinations is the gateway allowed
to dial" — that is the data model already encoded in egress rules and
gated by `ext_authz` on the gateway's Envoy. Spreading NPs to every
destination couples the security policy to the cluster topology
instead of the rule model.

## Consequences

- The agent → gateway hop is no longer mTLS-encrypted at the underlay.
  TLS protection at the application layer is preserved: the agent's
  `HTTPS_PROXY` tunnel terminates at Envoy on the gateway pod, and
  Envoy mints the leaf cert agent clients trust via the MITM CA bundle
  ([ADR-033](033-envoy-credential-gateway.md)).
- The kernel boundary is robust to mesh control-plane disturbances —
  ztunnel restart, istiod issuing-cert blips, AuthorizationPolicy edit
  not yet converged. The agent's egress shape does not depend on any
  of them.
- DNS tunneling via CoreDNS's upstream forwarder remains a residual,
  low-bandwidth exfil channel. The NetworkPolicy must admit DNS to
  `kube-system`; CoreDNS forwards non-cluster queries upstream by
  default. Closing this requires per-pod DNS policy or a DNS-aware
  egress filter, neither in scope here.
- The gateway pod must accept inbound traffic from a non-mesh source
  on its Envoy port. Ambient ztunnel-on-inbound passes through
  plaintext on non-HBONE ports when no ALLOW AuthorizationPolicy is
  attached to the destination; retiring the gateway-allow policy is
  what makes that pass-through legal. If a future change re-introduces
  an ALLOW on the gateway pod, it must explicitly admit the
  non-principal (out-of-mesh) source or the agent → gateway hop will
  TCP-refuse.
- The agent pod has no SPIFFE workload identity. Any future code that
  tries to authenticate the agent by mesh principal (rather than by
  the gateway-pod principal on its behalf) will fail closed.
