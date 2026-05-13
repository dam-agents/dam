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

**Agent pods opt out of ambient mesh.** The agent process runs
untrusted code; its only legitimate destination is its paired
gateway. Keeping the agent in ambient means istio-cni redirects
outbound to ztunnel before NetworkPolicy evaluates, so NP can't gate
per-destination — and the egress-waypoint pattern that would gate
at the mesh layer turned out to be brittle in current Istio (label
semantics on `istio.io/use-waypoint` differ from documentation, and
`waypoint-for: none` interacts badly with Service binding).

Opting the agent out of ambient (`istio.io/dataplane-mode: none` at
the pod template) makes the kernel the only path. The agent has no
SPIFFE identity, no ztunnel redirect, no mesh participation. Its
outbound is gated by a per-pair NetworkPolicy that admits exactly
DNS to `kube-system` and the paired gateway pod on the Envoy proxy
port. Nothing else — not other agents, not other pair's gateway,
not release-ns workloads, not external IPs. The kernel can't be
spoofed: the agent pod has the source IP that it has.

The gateway pod stays in ambient. The pod is platform-controlled
(rendered Envoy + rendered config); its outbound destinations are
gated by:

- Mesh AuthorizationPolicy on the destination side
  (`<id>-harness-allow` admits gateway SA at the api-server waypoint;
  `<id>-extauthz-allow` admits gateway SA at the per-instance
  ext-authz Service; `release-ns-baseline` blocks anything else in
  release-ns).
- ext_authz on the gateway's Envoy itself: every credentialed and
  SNI-miss request hits the api-server's ext-authz handler, which
  matches against the instance's configured egress rules or falls
  through to a HITL approval (denying when host info is missing).

That's the destination-side gate that the abandoned waypoint
approach was trying to add — and it was already there. The agent's
inability to reach anything but the gateway means the gateway is
necessarily the chokepoint for everything downstream.

**Per-pair ServiceAccount split (supersedes [ADR-041](041-istio-ambient-mesh.md)
§ Per-instance SA).** Each pair runs as **two** ServiceAccounts:

- Agent SA = `<id>` (long-lived) / `<forkName>` (fork) — used as the
  pod's K8s service account, but the agent is non-ambient so this
  SA has no SPIFFE identity in the mesh.
- Gateway SA = `<id>-gateway` (long-lived) / `<forkName>-gateway`
  (fork) — the only SA with a mesh principal.

Per-instance AuthorizationPolicies (the two surviving from ADR-041
after the agent ↔ gateway hop moved to NetworkPolicy):

- *Harness path-prefix at the waypoint* (release ns) — ALLOWs only
  the gateway SA principal to `/api/instances/<id>/*`. The agent has
  no mesh principal at all; even if it could somehow reach the
  waypoint, it couldn't be admitted. All harness traffic must route
  through the gateway by construction.
- *Per-instance ext-authz Service* (release ns) — ALLOWs only the
  gateway SA principal. Same construction; ext-authz Check calls
  originate from the gateway's Envoy filter.

Fork variants admit the fork gateway SA at the parent's harness MCP
path and the parent's ext-authz Service.

The agent ↔ gateway hop is gated by **per-pair NetworkPolicies**
(not mesh AuthorizationPolicy, because the agent has no SPIFFE
identity to match):

- `<id>-agent-egress` on the agent pod — allows DNS to `kube-system`
  and the paired gateway pod (`pair=<id>, role=gateway`) on the
  Envoy proxy port.
- `<id>-gateway-ingress` on the gateway pod — allows the paired
  agent pod (`pair=<id>, role=agent`) on the Envoy proxy port.

Symmetric pair-pinning at the kernel level. Both controller-rendered.

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
- **"Agent only calls gateway" holds by construction.** The agent
  pod's kernel-level egress admits exactly two destinations: DNS in
  `kube-system` and its paired gateway pod. Nothing else — no other
  agent, no release-ns workload, no external IP. NetworkPolicy is
  identity-blind but enforces at L3/L4 with no redirect layer to
  obscure the destination.
- **Agent has no mesh participation.** No SPIFFE identity, no
  ztunnel routing, no mesh AuthorizationPolicy on its ingress or
  egress. Inbound from api-server / controller is gated by a
  chart-rendered `<release>-agent-pod-ingress` NetworkPolicy (allow
  api-server + controller pods on port 8080).
- **Where the gateway dials is gated by ext_authz.** Every credentialed
  and SNI-miss egress through the gateway's Envoy hits the api-server's
  ext-authz handler, which matches against the instance's egress
  rules or falls through to HITL approval (denying when host info is
  missing). This is the existing ADR-035 gate — the abandoned
  waypoint approach was duplicating work ext_authz already does.
- **Waypoint approach rejected.** An earlier draft of this ADR
  deployed an egress Waypoint with an AuthorizationPolicy gating
  per-source-SA. In practice `istio.io/use-waypoint` on a namespace
  caused Service-binding errors (the waypoint's `waypoint-for: none`
  conflicts with destination-side Service routing), and even removing
  the labels left ztunnel in a state where the agent's outbound was
  TCP-refused with no path to the gateway. Reverted in favour of
  opt-out-of-ambient + NetworkPolicy.
- **Chart shape.** Chart-rendered AuthorizationPolicies:
  `<release>-release-ns-baseline` (default-deny release-ns),
  `<release>-apiserver-pod-deny` (pod-level DENY on api-server's
  harness + ext-authz ports). Chart-rendered NetworkPolicies:
  `<release>-agent-pod-ingress` (api-server + controller → agent
  port 8080), `<release>-gateway-egress` (gateway perimeter:
  DNS + mesh entrance + ipBlock with `clusterCidrs` excepted).
  Controller-rendered per-pair: `<id>-harness-allow`,
  `<id>-extauthz-allow`, `<id>-agent-egress` (NP),
  `<id>-gateway-ingress` (NP), per-instance ext-authz Service.
- **SA-split rolling upgrade has a transient denial window.** When
  AuthorizationPolicies for harness/ext-authz rebind from `<id>` to
  `<id>-gateway` and the gateway StatefulSet pod template adopts the
  new SA, the rollout isn't atomic. During the gap between policy
  apply and pod restart, an old gateway pod still running as `<id>`
  is denied at harness + ext-authz. Acceptable for in-place
  upgrades; zero-downtime migration would require admitting both
  old and new SA principals temporarily before tightening.
- **IPv6 dual-stack clusters need explicit `clusterCidrs` coverage.**
  Default `clusterCidrs` includes RFC4193 ULA (`fc00::/7`) and
  RFC4291 link-local (`fe80::/10`) to cover dual-stack clusters, but
  operators on clusters using globally-routable IPv6 prefixes for
  pods must extend the list with their pod + service CIDRs. The
  gateway-egress NP renders IPv4 and IPv6 `ipBlock` peers
  separately (Kubernetes NP requires `except` to be a strict subset
  of `cidr`, so mixing families breaks validation).

## Related ADRs

- [ADR-041](041-istio-ambient-mesh.md) — SPIFFE identity model and
  per-instance AuthorizationPolicies; this ADR extends the principle
  to namespace-wide and chart-rendered policies and reconciles the
  NetworkPolicy framing.
- [ADR-038](038-paired-gateway-pod.md) — paired-pod NetworkPolicies
  acquire their honest role here (perimeter, not destination control).
- [ADR-005](005-credential-gateway.md) — credential-gateway pattern
  unchanged.
