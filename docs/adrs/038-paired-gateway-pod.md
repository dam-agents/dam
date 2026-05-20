# ADR-038: Paired agent and gateway pods — cluster-enforced credential boundary

**Date:** 2026-05-06
**Status:** Accepted
**Owner:** @pilartomas

## Context

[ADR-033](033-envoy-credential-gateway.md) runs Envoy as a sidecar in the
agent pod. Agent and sidecar share a network namespace, so the pod's
NetworkPolicy must admit egress on TCP 80/443 for Envoy to reach upstreams
([resources.go:325-329](../../packages/controller/pkg/reconciler/resources.go#L325-L329)).
The same rule admits direct egress from the agent process. `HTTPS_PROXY=127.0.0.1:<port>`
is just an env var; an agent that ignores it bypasses Envoy entirely —
no credential injection, no HITL, no audit. The boundary is cooperative,
not enforced.

ADR-033 rejected a namespace-shared Envoy because it would put a pod-IP
resolver on the request path with an IP-reuse race. That argument is
specific to a *shared* Envoy. A per-instance Envoy in its own paired pod
preserves the 1:1 identity ADR-033 valued.

## Decision

Run **two paired pods per instance**, agent and gateway, with NetworkPolicies
the cluster enforces:

- **Agent pod** egress: paired gateway pod only, plus api-server harness
  port and DNS. No path to TCP 80/443.
- **Gateway pod** ingress: paired agent pod only. Egress: TCP 80/443
  anywhere, ext_authz to api-server, DNS.

Pairing is keyed on `agent-platform.ai/instance` plus a new
`agent-platform.ai/role` ∈ `{agent, gateway}` label. The controller renders
the pair as a unit from the existing `agent-instance` ConfigMap; no new
resource type ([ADR-006](006-configmaps-over-crds.md) preserved).

The agent reaches the gateway through a per-instance headless Service,
`<instance>-gateway`. `HTTPS_PROXY` becomes the Service DNS name —
stable across gateway pod restarts, no controller re-render on IP change.
Envoy's listener moves from `127.0.0.1` to `0.0.0.0`; reach is gated by
NetworkPolicy, not bind address.

Credential Secrets, the leaf TLS Secret, and the Envoy bootstrap ConfigMap
move to the gateway pod. The agent pod keeps only the CA bundle.
`automountServiceAccountToken: false` stays on both.

ADR-035's pod-IP resolver (`pod-ip-resolver.ts`, removed in ADR-041)
narrows its filter to `role=gateway`. The IP source moves from agent pod
to gateway pod; the protocol, rule model, and `x-platform-instance`
header check are unchanged.

**Fork Jobs** ([ADR-027](027-slack-user-impersonation.md)) inherit the
shape: each fork spawns a paired gateway Job and gains a per-fork
NetworkPolicy pair (forks have no NetworkPolicy today, so this closes the
bypass for forks at the same time).

This ADR supersedes the sidecar topology in ADR-033 and the parts of its
threat model that depend on the shared network namespace
(`HTTPS_PROXY` honoring, Envoy admin reachability, shared PID, in-pod
escape to a co-located sidecar's volumes). ADR-005's pattern and the
rest of ADR-033 (Envoy filters, credential injection, refresh loops,
`(owner, connection)` Secret model) are unchanged. ADR-035 is unchanged.

## Alternatives Considered

**In-pod iptables/eBPF redirect to `127.0.0.1`.** Rejected: anything inside
the pod is on the untrusted side of the boundary. The rule table is in
the agent's namespace; an attacker with `CAP_NET_ADMIN` rewrites it, and
even without that capability can connect out unredirected on a different
local port. Behavioral mitigation, not structural.

**Namespace-shared Envoy.** Rejected by ADR-033 already. A shared gateway
puts a pod-IP-to-instance resolver on the request path with an IP-reuse
race; this ADR keeps the per-instance Envoy precisely to avoid that.

**mTLS-only between agent and a shared gateway pool.** Rejected: requires
a per-instance identity issuer, certificate distribution the agent
container cannot read directly, and Envoy config branched on client
identity. Higher operational and verification cost than two pods plus
two NetworkPolicies. mTLS as defense-in-depth on top of the paired-pod
split is a clean v1.5 follow-on.

**Per-instance pod-DNS or downward-API IP injection.** Rejected: pod
ordinals and pod IPs are not stable across restarts; the agent's env
goes stale. A Service is the indirection that solves this.

## Consequences

- **Bypass closes structurally.** The agent's NetworkPolicy admits no path
  to TCP 80/443 other than its paired gateway. Boundary stops depending
  on the agent honoring an env var.
- **Resource doubling per instance.** Two pods, two NetworkPolicies, one
  extra Service per instance and per fork. Idle Envoy is ~30–50 MB RSS,
  small relative to the agent process.
- **Controller render split.** [`BuildStatefulSet`](../../packages/controller/pkg/reconciler/resources.go),
  [`BuildNetworkPolicy`](../../packages/controller/pkg/reconciler/resources.go),
  and [`BuildForkJob`](../../packages/controller/pkg/reconciler/fork_resources.go)
  become role-aware. Envoy bootstrap and credential volumes
  ([envoy.go:670-759](../../packages/controller/pkg/reconciler/envoy.go#L670-L759))
  attach to the gateway only.
- **Forks gain a NetworkPolicy.** Today fork pods have none.
- **`HTTPS_PROXY` becomes a Service DNS name.** Harness images need no
  changes; they already honor the env var.
- **Architecture pages update on acceptance.** [`security-and-credentials.md`](../architecture/security-and-credentials.md)
  and [`platform-topology.md`](../architecture/platform-topology.md) gain
  the gateway pod and lose the "sidecar inside the agent pod" framing.
- **Container escape from the agent.** No longer reaches the gateway's
  Secret volumes (different pod UID directory). Host-root escape still
  reaches everything; gVisor / Kata at the pod level remains load-bearing.
- **Gateway ingress on `0.0.0.0`.** The NetworkPolicy ingress selector
  must exact-match on `instance=<name>`; a wildcard would let one
  instance's agent dial another's gateway.
- **mTLS as defense-in-depth deferred to v1.5.** Catches NetworkPolicy
  misconfiguration without changing this ADR's shape.

## Related ADRs

- [ADR-005](005-credential-gateway.md) — pattern preserved.
- [ADR-033](033-envoy-credential-gateway.md) — topology and shared-NS
  threat-model items superseded.
- [ADR-035](035-unified-hitl-ux.md) — rule model unchanged; resolver IP
  source moves to gateway pod.
- [ADR-027](027-slack-user-impersonation.md) — fork Jobs gain a paired
  gateway Job and per-fork NetworkPolicy pair.
