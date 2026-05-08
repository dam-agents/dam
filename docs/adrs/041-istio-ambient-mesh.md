# ADR-041: Istio ambient mesh — SPIFFE identity for every internal hop

**Date:** 2026-05-07
**Status:** Accepted
**Owner:** @pilartomas

## Context

Internal platform traffic — agent → gateway, agent → api-server harness,
gateway → api-server ext-authz — has, until now, been admitted by labels
and pod-IP topology. [ADR-038](038-paired-gateway-pod.md) gates the
agent → gateway pair with a kernel NetworkPolicy keyed on a pair label.
[ADR-035](035-unified-hitl-ux.md) identifies the calling instance on the
ext-authz path from the source pod's IP, with a defense-in-depth header
the gateway pod's Envoy stamps. The harness port has no app-level
identity at all — its bearer-token producer was never wired up.

Three properties of this stack are unsatisfying:

1. **No cryptographic identity.** Pod IP and label selectors are stable
   under K8s + standard CNIs but not provable. A novel CNI bug or
   hostNetwork interaction can break the mapping the api-server depends
   on.
2. **Three different mechanisms for one question.** "Who is calling?"
   resolves through pair-key labels in one place, source IP in another,
   and not at all in a third. Each path is its own audit surface.
3. **The bearer-token shape that was specced for the harness port pulls
   a long-lived secret into a pod the agent shares a namespace with.**
   Adopting it makes Keycloak a per-call control-plane authority and
   binds every harness call to its uptime.

A workload-identity primitive answers all three at once: identity
becomes a property of *where the pod runs*. The SPIFFE workload cert
istiod stamps onto a pod is bound by the K8s scheduler to the pod's
ServiceAccount; the SA name is the identity. Nothing to mint, leak,
rotate, or sync across control planes.

## Decision

Adopt **Istio ambient mesh** with a **per-instance Kubernetes
ServiceAccount** as the single identity primitive for every internal hop.
SPIFFE workload identity replaces the pair-key NetworkPolicy, the
pod-IP resolver, and the trusted `x-platform-instance` header.

- **Per-instance SA.** Controller writes one SA per instance in the
  agent namespace, name == instance ID. Owner-refed to the instance
  ConfigMap; K8s GC reaps it on delete. Both pods of the long-lived
  pair (agent + gateway) run as that SA. `automountServiceAccountToken:
  false` is preserved; Istio workload identity does not depend on
  SA-token mounts.

- **Per-fork SA, narrower harness surface.** Fork pairs (ADR-027) get
  their **own** SA, not the parent's, so a compromised fork (i.e. a
  compromised foreign replier) cannot reach the parent's full
  `/api/instances/<parent>/*` surface. The controller renders two
  per-fork policies in the release namespace alongside the per-fork
  SA: a *fork-harness* AuthorizationPolicy admitting the fork SA only
  to `/api/instances/<parent>/mcp`, and a *fork-ext-authz*
  AuthorizationPolicy admitting the fork SA to the parent's
  per-instance ext-authz Service (the parent owner's HITL rules stay
  the gate; the fork's gateway then injects the replier's credential
  on the wire). Istio OR-s ALLOWs across multiple policies on the
  same Service / waypoint, so the per-fork policies are purely
  additive.

- **Three per-instance AuthorizationPolicies.** Controller writes them
  alongside the SA:
  1. *Gateway admission* (agent ns) — selector matches gateway pods of
     this pair, ALLOWs only the matching SA principal.
  2. *Harness path-prefix at the waypoint* (release ns) — `targetRefs`
     the api-server's waypoint Gateway, ALLOWs the SA principal to
     `/api/instances/<id>/*`.
  3. *Per-instance ext-authz Service* (release ns) — `targetRefs` the
     per-instance ext-authz Service the controller renders, ALLOWs the
     SA principal only.

- **api-server Service split.** The bare apiserver Service keeps only
  the public HTTP/tRPC port. A new `<rel>-apiserver-harness` Service
  carries the harness port and the `istio.io/use-waypoint` label
  (Istio 1.21+ ignores the annotation form). One waypoint Gateway
  resource (Gateway-API CRD, `gatewayClassName: istio-waypoint`) fronts
  it; Istio's mesh-controller synthesises the waypoint Deployment + Pod.
  Per-instance ext-authz Services (`<rel>-extauthz-<id>`) are
  controller-rendered and use L4 ambient — no waypoint hop on the
  credential-injection hot path.

- **Why harness and ext-authz use different enforcement shapes.** The
  asymmetry is driven by request shape, not preference:

  | | Harness | ext-authz |
  |---|---|---|
  | Protocol | HTTP/REST | gRPC, fixed method path |
  | Instance ID in request | URL path: `/api/instances/<id>/...` | nowhere |
  | Latency budget | slack — occasional MCP / SSE / trigger | hot path — fires on every credentialed agent egress |

  Harness has `<id>` in the URL, so the natural binding is **L7
  path-matching at a waypoint**: one shared Service, one waypoint, one
  per-instance AuthorizationPolicy keyed on `principal == <id>` AND
  `path == /api/instances/<id>/*`. The handlers were already written
  to take `:id` from route params — REST-shaped — so this is the
  least-disruptive fit.

  ext-authz has no `<id>` anywhere in the request (the gRPC method is
  fixed). To get instance identity into the api-server we'd have to
  derive it from `:authority`, a header, or `context_extensions`. L4
  AuthorizationPolicy can't match on `:authority` (that's L7), so a
  shared Service would force a waypoint — adding latency to every
  credential injection. **Per-instance Service + L4 policy** pushes
  the principal-to-instance binding into the routing topology
  instead: each Service has one ALLOW rule with one principal, no L7
  needed, and the api-server reads `:authority` (already populated
  by Envoy from the upstream cluster) to know which instance is
  calling. The cryptographic pinning happens at L4 *before* the call
  lands on the api-server.

  Heuristic for future endpoints joining this stack:

  - **Has an `<id>`-bearing URL or other L7 field** → shared Service
    via waypoint, path-based AuthorizationPolicy.
  - **No instance discriminator in the request** → per-instance
    Service, L4 AuthorizationPolicy, derive instance from
    `:authority`.

- **`/internal/trigger` moves under `/api/instances/:id/internal/trigger`.**
  Falls under the same path-prefix AuthorizationPolicy as MCP and
  pod-files; the body's `instanceId` field is preserved for
  compatibility but ignored — the URL is the source of truth.

- **api-server reads identity from request shape, never from a header.**
  Harness handlers trust the URL `:id` (waypoint admitted only the SA
  principal whose name equals it). The ext-authz handler parses the
  instance ID from the gRPC `:authority` of the per-instance Service it
  was dialled on. The pod-IP resolver and the `x-platform-instance`
  header are gone.

- **Pair-key NetworkPolicy from ADR-038 is superseded.** Pair isolation
  is now cryptographic. NetworkPolicy retracts to coarse perimeter
  rules — namespace-level egress allowlists, cluster-edge ingress —
  where its identity-blind kernel enforcement is still load-bearing
  and not duplicative.

- **Istio is a hard cluster prerequisite.** A `lookup`-based
  `validate-istio.yaml` template fails `helm install` if the
  AuthorizationPolicy CRD, Gateway-API CRDs, or the ztunnel DaemonSet
  is missing, or if the release namespace is not labelled ambient.
  There is no `enabled: false` toggle — an unauthenticated harness
  port is not a supported configuration. `mise run cluster:install`
  provisions Istio out-of-band, mirroring how cert-manager is treated.

## Alternatives Considered

**Keycloak M2M (client_credentials).** Per-instance Keycloak client; the
gateway pod exchanges `client_id + client_secret` for a short-lived JWT.
Rejected: lifecycle spans two control planes (instance reconcile must
also reconcile a Keycloak client + secret); the long-lived `client_secret`
still has to live somewhere the harness cannot read; Keycloak's role
expands from user IdP to the identity authority for every internal call.
Standards/federation wins only matter when something off-cluster needs
to authenticate, which is not on the roadmap.

**Forks reuse the parent's SA.** Rejected: a fork pod with the parent's
SPIFFE principal would be admitted to the parent's full
`/api/instances/<parent>/*` surface, including pod-files SSE and the
trigger endpoint — exposing the parent owner's connection data to the
foreign replier. Per-fork SA + per-fork narrow harness policy preserves
ADR-027's intent: the fork acts on the parent's session but with the
replier's credentials and a tighter authorization surface than the
parent itself has.

**Istio sidecar mode** instead of ambient. Rejected: 30–50 MB RSS per
pod on top of the existing Envoy credential gateway ([ADR-033](033-envoy-credential-gateway.md));
ambient runs at the node so the gateway's Envoy is unaffected.

**Waypoint for ext-authz too.** Considered for symmetry with the harness
path. Rejected: ext-authz is on the credential-injection hot path
(every external call from an agent fires a Check), and a waypoint hop
adds latency for no security gain — per-instance Service + L4
AuthorizationPolicy already pins identity to the matching SA principal,
and the api-server can derive instance ID from the Service `:authority`
without L7 visibility.

**`cert-manager-istio-csr`** to chain Istio's workload certs to a
cert-manager root. Orthogonal; clean follow-up if a unified PKI is ever
wanted.

## Consequences

- The agent pod stays credential-free at the K8s API surface:
  `automountServiceAccountToken: false` is preserved; ambient identity
  is independent of SA-token mounts.
- Two PKIs cohabit: cert-manager continues to issue per-instance Envoy
  MITM leaf certs ([ADR-033](033-envoy-credential-gateway.md));
  istiod issues SPIFFE workload certs. They serve different problems
  and do not overlap.
- New cluster dependency: istiod, istio-cni, ztunnel DaemonSet, plus one
  waypoint pod per api-server release. Documented as a deployment
  prerequisite alongside cert-manager.
- Per-instance K8s churn on instance create: SA + ext-authz Service +
  three AuthorizationPolicies, all owner-refed. Reaped together by GC.
- ext-authz remains L4 (no waypoint), so the credential-injection
  latency budget is unchanged.
- ADR-038's pair-isolation *concept* survives — paired pods, credential
  boundary at the pod boundary; only its enforcement *mechanism*
  (kernel NetworkPolicy keyed on pair label) is superseded by mesh
  AuthorizationPolicy. ADR-038's `pair`/`role` labels remain the
  structural pairing keys (the controller still uses them to render
  the StatefulSet/Pod selectors that AuthorizationPolicies target).
- Architecture pages update on acceptance: [`security-and-credentials.md`](../architecture/security-and-credentials.md)
  gains the SPIFFE chain and loses the trusted-header narrative;
  [`platform-topology.md`](../architecture/platform-topology.md) gains
  the harness Service split and the per-instance ext-authz Service.

## Related ADRs

- [ADR-005](005-credential-gateway.md) — credential-gateway pattern preserved.
- [ADR-033](033-envoy-credential-gateway.md) — Envoy MITM unchanged; the
  bootstrap drops the `x-platform-instance` header it used to stamp.
- [ADR-035](035-unified-hitl-ux.md) — gate / rule model unchanged; the
  pod-IP resolver and the trusted-header check are removed in favour
  of per-instance Service routing + AuthorizationPolicy.
- [ADR-038](038-paired-gateway-pod.md) — pair-isolation concept preserved;
  kernel NetworkPolicy mechanism superseded by per-instance Istio
  AuthorizationPolicy.
- [ADR-027](027-slack-user-impersonation.md) — fork pairs get their
  OWN per-fork SA + per-fork harness/ext-authz AuthorizationPolicies
  scoped narrowly to `/api/instances/<parent>/mcp` and the parent's
  ext-authz Service, preserving the fork's reduced trust surface.
