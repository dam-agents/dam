# ADR-042: AuthorizationPolicy as primary access control in ambient mesh

**Date:** 2026-05-12
**Status:** Accepted
**Owner:** @pilartomas

## Context

[ADR-041](041-istio-ambient-mesh.md) put every internal hop on SPIFFE
identity and moved per-instance pair isolation, harness admission, and
ext-authz caller checks onto Istio AuthorizationPolicy. It noted that
NetworkPolicy "retracts to coarse perimeter only" but kept per-pair NP
rules that read as literal destination control.

In ambient mode those rules don't enforce what they appear to.
istio-cni installs iptables redirects inside each ambient pod's
network namespace that rewrite outbound destination to local ztunnel
on port 15008 — **before** the CNI plugin's NetworkPolicy filter
evaluates the packet. The kernel-level destination of every mesh-bound
packet is therefore ztunnel, not the workload the source pod intended
to reach. A NetworkPolicy rule that says "allow egress to paired
gateway pod" never fires for mesh traffic; the rule that does fire is
"allow egress to `istio-system:15008`," which is destination-blind.

The cost of leaving this ambiguous is two-fold: NP rules look like
access controls but aren't, and intra-cluster destinations operators
assume NP gates sit without an AuthorizationPolicy.

## Decision

**Istio AuthorizationPolicy is the sole source of truth for
intra-cluster destination access control. NetworkPolicy retracts to
defense-in-depth perimeter.**

- Every intra-cluster destination that needs gating gets an
  AuthorizationPolicy. Istio's "any ALLOW switches the workload to
  default-deny" semantic carries the deny-by-default property without
  explicit DENY rules.
- Three scopes, in increasing breadth:
  - **Per-workload `ALLOW`** (selector + principals) — gateway pods,
    agent pods, ext-authz Services, harness path-prefix at the
    waypoint. Pair-internal admission, per-instance principals.
  - **Per-namespace `ALLOW`** (no selector; enumerates legitimate
    cross-namespace and edge ingress) — release-ns default-deny.
    New release-ns workloads inherit the gate.
  - **Root-namespace mesh-wide policy** — reserved for cluster-wide
    bans; not used today.
- NetworkPolicy retains three jobs, all perimeter:
  - **Cluster-edge ingress** — what reaches the cluster from outside
    the mesh.
  - **Non-mesh egress shape** — `ipBlock 0.0.0.0/0` with `clusterCidrs`
    excepted on the gateway pod, bounding direct pod-IP dialing in
    the event istio-cni redirect doesn't apply.
  - **Mesh-entrance allow** — `istio-system:15008` and `kube-system:53`
    so meshed pods can reach the mesh and DNS.
- NetworkPolicy must not encode per-destination intra-cluster gating.
  Pod-selector rules for ambient destinations are removed.

**Source-side egress control via Waypoint.** Destination-side
AuthorizationPolicy gates traffic to workloads with SPIFFE identity;
external destinations have none, so ztunnel forwards them by default.
Without a gate, a compromised agent process could bypass `HTTPS_PROXY`
and reach the open internet directly through ztunnel — NetworkPolicy
cannot help because istio-cni redirects outbound to ztunnel before
the NP filter evaluates.

The Istio-native answer is an **egress Waypoint**: a Gateway resource
(`gatewayClassName: istio-waypoint`) Istio synthesises into a
namespace-scoped pod that ztunnel routes outbound through. The waypoint
is a workload with a SPIFFE identity, so an AuthorizationPolicy with
`targetRefs` pointing at it gates traffic by **source** principal.

For the agent namespace, the waypoint AuthorizationPolicy ALLOWs only
gateway pod SAs (SPIFFE wildcard `sa/*-gateway`, covering both
long-lived `<id>-gateway` and fork `<forkName>-gateway`). Agent pod
SAs (`<id>`, `<forkName>`) don't match — outbound from agents fails
at the waypoint regardless of destination. The gateway itself routes
through the waypoint, passes the policy, and reaches its actual
destination (mesh peer or external).

`istio.io/waypoint-for: none` on the waypoint keeps it egress-only —
it does not intercept ingress to services in the namespace (per-instance
policies on gateway and agent pods continue to handle ingress).

**Per-pair ServiceAccount split (supersedes [ADR-041](041-istio-ambient-mesh.md)
§ Per-instance SA).** Each pair runs as **two** ServiceAccounts:

- Agent SA = `<id>` (long-lived) / `<forkName>` (fork).
- Gateway SA = `<id>-gateway` (long-lived) / `<forkName>-gateway`
  (fork).

The agent's SPIFFE principal is distinct from the gateway's, so
destination AuthorizationPolicies can admit one without admitting the
other. Per-instance policies (the three from ADR-041) rebind their
principals accordingly:

- *Gateway admission* (agent ns) — ALLOWs only the agent SA
  principal. The agent dials its paired gateway; nothing else needs
  to.
- *Harness path-prefix at the waypoint* (release ns) — ALLOWs only
  the gateway SA principal. The agent's SPIFFE identity is not
  admitted, so all harness traffic must route through the gateway by
  construction.
- *Per-instance ext-authz Service* (release ns) — ALLOWs only the
  gateway SA principal. Same construction; ext-authz Check calls
  originate from the gateway's Envoy filter.

Fork variants admit the fork gateway SA at the parent's harness MCP
path and the parent's ext-authz Service (replacing the prior
fork-SA-only admission, which couldn't distinguish fork agent from
fork gateway).

## Alternatives Considered

**Keep per-destination NP rules as "belt and suspenders."** Rejected:
they don't fire and create false confidence on read. Operators
auditing the chart see "egress only to paired gateway" and assume the
rule constrains traffic; in ambient it doesn't.

**Drop NetworkPolicy entirely.** Rejected: ambient depends on
istio-cni's iptables redirect being present in every ambient pod's
netns. NP at the host's forward chain is the failsafe if the redirect
doesn't apply (CNI plugin bug, init-container failure, ambient label
flip, raw socket from a privileged escape). Defense-in-depth at the
kernel layer is cheap.

**Mesh-wide root-namespace policy as primary.** Rejected for now:
works for blanket bans but doesn't compose cleanly with per-instance
and per-namespace policies. The per-workload + per-namespace model
covers our use cases; root-namespace stays reserved for future
cluster-wide rules.

## Consequences

- **AuthorizationPolicy coverage is mandatory** for every gated
  intra-cluster destination. New workloads in the release namespace
  inherit `release-ns-baseline` default-deny — operators adding a
  workload must enumerate its legitimate callers or the workload is
  unreachable. This is a feature.
- **NetworkPolicy reviews are perimeter reviews.** Rules either gate
  non-mesh paths or they don't fire; the question "does this rule
  fire?" goes away.
- **"Agent only calls gateway" holds by construction.** With the
  per-pair SA split, the agent's SPIFFE principal is admitted at
  exactly one destination — its paired gateway. The agent process
  bypassing `HTTPS_PROXY` and attempting to dial harness, ext-authz,
  or any other in-mesh destination directly is denied at the mesh
  layer regardless of pod label or path.
- **External egress restricted to gateway pods.** The agent-ns egress
  waypoint admits only gateway SAs. Agents dialing arbitrary external
  hosts (data exfiltration, C2 polling) fail at the waypoint — even
  if they bypass `HTTPS_PROXY`. The gateway pod retains unrestricted
  external egress and remains the sole credentialed exit path. The
  same mechanism generalises to other namespaces (one waypoint +
  policy per namespace) but is applied only to the agent namespace
  in this ADR; release-namespace egress restrictions are a follow-on
  decision (api-server legitimately needs external egress for OAuth +
  messenger integrations, which complicates the policy enumeration).
- **One chart-rendered AuthorizationPolicy per namespace plus
  per-workload policies.** Cluster shape: `<release>-release-ns-baseline`
  covers release-ns; `<release>-agent-pod-allow` covers agent pods in
  the agent namespace; per-instance and per-fork policies continue to
  be controller-rendered as in ADR-041.
- **Waypoint pod availability is on the agent-egress critical path.**
  All agent-ns outbound routes through the namespace's egress waypoint
  pod. If the waypoint pod is unavailable (initial deploy, OOMKill,
  eviction, node restart) every agent + gateway outbound fails until
  the waypoint is back. Istio synthesises the waypoint Deployment with
  default replicas: operators running production-scale should size
  replicas / PDB / resources appropriately; a single-replica waypoint
  is acceptable for dev but a SPOF for the platform's outbound path.
- **SA-split rolling upgrade has a transient denial window.** The
  controller reconciles per-instance AuthorizationPolicies (harness +
  ext-authz now admitting `<id>-gateway`) and the gateway StatefulSet
  pod template (now running as `<id>-gateway` SA) in the same loop,
  but the rollout is not atomic. During the gap between policy apply
  and pod restart, the old gateway pod (still running as `<id>`) is
  denied at harness + ext-authz. Agents see in-flight requests fail
  until the new pod is Ready. Acceptable for in-place upgrades;
  zero-downtime migration would require admitting both old and new
  SA principals temporarily before tightening.
- **Initial install / namespace label change disrupts running
  instances.** `istio.io/use-waypoint` on the namespace is applied
  atomically with the Gateway resource and AuthorizationPolicy, but
  the waypoint pod takes time to come up. Any running instance's
  outbound (gateway → upstream API) fails between when ztunnel
  starts routing through the waypoint name and when the waypoint pod
  is Ready. First install on a fresh cluster: no impact. In-place
  chart upgrade with running instances: brief outbound outage. Plan
  upgrades during low-traffic windows or hibernate instances first.
- **IPv6 dual-stack clusters need explicit `clusterCidrs` coverage.**
  Default `clusterCidrs` includes RFC4193 ULA (`fc00::/7`) and
  RFC4291 link-local (`fe80::/10`) to cover dual-stack clusters, but
  operators on clusters using globally-routable IPv6 prefixes for
  pods must extend the list with their pod + service CIDRs.

## Related ADRs

- [ADR-041](041-istio-ambient-mesh.md) — SPIFFE identity model and
  per-instance AuthorizationPolicies; this ADR extends the principle
  to namespace-wide and chart-rendered policies and reconciles the
  NetworkPolicy framing.
- [ADR-038](038-paired-gateway-pod.md) — paired-pod NetworkPolicies
  acquire their honest role here (perimeter, not destination control).
- [ADR-005](005-credential-gateway.md) — credential-gateway pattern
  unchanged.
