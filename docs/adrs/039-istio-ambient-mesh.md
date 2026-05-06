# ADR-039: Istio ambient mesh for agent → platform identity

**Date:** 2026-05-06
**Status:** Accepted
**Owner:** @pilartomas

## Context

The api-server's harness port (agent → platform internal endpoints —
`/api/instances/:id/mcp`, `/api/instances/:id/pod-files/events`,
`/internal/trigger`) has no cryptographic auth today. The boundary is
NetworkPolicy + an unused per-instance bearer-token shim: the token
producer (`WriteAgentStatus`) was never wired up, so MCP and pod-files
SSE 404 on every call (the agent stopped sending the token in a prior
refactor; the platform side still tries to verify it). `/internal/trigger`
has no auth at all. A compromised pod could impersonate another
instance to the platform, and the half-finished migration leaves real
breakage (pod-files-SSE retry loop, MCP tool calls failing) in its wake.

Two structurally different identity primitives address this:

- **Keycloak M2M (client_credentials).** Per-instance Keycloak client; the
  gateway pod holds `client_id + client_secret` and exchanges them for a
  short-lived JWT on outbound platform calls. Token rotation built-in,
  standards-based, federation-friendly. *But:* lifecycle now spans two
  control planes, the long-lived secret still has to live somewhere the
  harness cannot read, and Keycloak's role expands from user IdP to
  control-plane identity authority for every internal call.
- **Istio ambient L4 mTLS + per-instance ServiceAccount.** Identity is a
  property of where the pod runs — possession of the SA at scheduling time
  *is* the proof. Nothing to mint, leak, rotate, or sync. Lifecycle is one
  system; SA owner-refed to the instance ConfigMap, K8s GC handles
  teardown. The cost is a new cluster dependency (istiod + ztunnel +
  istio-cni DaemonSet, plus a waypoint for the api-server).

For a single-cluster, internal-only platform with no off-cluster callers
on the near-term roadmap, the "no credential exists" property compounds.
Keycloak M2M's wins (standards-based, federation-friendly) only cash out
when something outside the cluster needs to authenticate.

## Decision

Adopt **Istio ambient mesh** as the auth primitive for agent → api-server
harness-port traffic. Each instance gets a **per-instance ServiceAccount**;
both pods of the long-lived pair (agent + gateway) and every per-turn
fork pair targeting that instance run as the same SA. The api-server
reads the inbound SPIFFE peer principal from the waypoint-injected
`x-forwarded-client-cert` header and rejects requests whose SA name
doesn't match the URL `:id`.

Concretely:

- **Per-instance SA, not per-pair.** Long-lived: SA name == instance name.
  Forks reuse the parent instance's SA. SPIFFE principal SA name == URL
  `:id` makes the cross-check identity equality. ADR-038's pair boundary
  stays L4 NetworkPolicy via `LabelPair` exact-match — sharing a SA across
  the agent/gateway pair doesn't weaken it.
- **Waypoint for the api-server harness Service.** Ambient L4 alone
  doesn't surface peer identity to the application — ztunnel forwards
  decrypted bytes after HBONE termination. A waypoint
  (`gatewayClassName: istio-waypoint`) terminates HBONE and emits XFCC.
  Attached via `istio.io/use-waypoint` on a dedicated harness-only
  Service so ext-authz gRPC traffic bypasses the waypoint hop.
- **Service split.** The existing api-server Service keeps `http` +
  `ext-authz`; a new `<release>-apiserver-harness` Service exposes only
  `harness` and carries the waypoint annotation. The controller's
  `PLATFORM_HARNESS_SERVER_URL` points at the new Service.
- **AuthorizationPolicy.** Pre-filters at the waypoint: ALLOW only mTLS
  principals from `<trust-domain>/ns/<agent-ns>/sa/*`. URL `:id`
  cross-check stays in app code.
- **App-layer middleware.** New `peer-identity.ts` reads XFCC, parses
  `URI=spiffe://<td>/ns/<ns>/sa/<sa>`, validates trust domain + namespace,
  stashes the SA name on the Hono context. Each handler cross-checks
  against URL `:id` (or trigger body's `instanceId`).
- **ext_authz unchanged.** Gateway → api-server (port 4002) keeps its
  pod-IP resolver. Out of scope here — gateway pods don't hold
  harness-port credentials, the resolver works, swap is risk for no
  benefit. Per-instance SA on gateway pods does future-proof a swap.

The bearer-token plumbing is removed: `verifyInstanceToken`,
`AgentStatus.AccessTokenHash`, and the dead `WriteAgentStatus` producer.
A new `resolveInstanceIdentity` helper resolves `(agentId, owner)` from
the instance CM for the verified peer principal — the identity-resolution
half of the old function, without the token check.

Istio itself is **not** bundled in the platform Helm chart. The
`cluster:install` mise task installs istio-base / istiod / istio-cni /
ztunnel idempotently before the platform chart, mirroring the existing
cert-manager handling. Production installs are expected to install Istio
out-of-band; the chart's `istio.enabled` value gates the consumer-side
resources.

## Alternatives Considered

**Keycloak M2M (client_credentials).** See Context. Rejected: lifecycle
spans two control planes; the long-lived secret still has to live where
the harness cannot read it, which is the same gateway-pod-isolation
property we'd need either way. Token-based wins (rotation, standards) only
matter when something off-cluster needs to authenticate.

**Per-pair SA (one SA per pair-key).** Rejected: forks have a pair-key
distinct from the parent instance. Per-pair SA would require a side
lookup from peer SA → parent instance for the URL `:id` check on every
fork request. Per-instance SA collapses that to identity equality.
Revocation of a fork is pod deletion either way (forks are short-lived
per-turn pods); per-pair SA buys nothing over that.

**Istio sidecar mode** (instead of ambient). Rejected: sidecar injection
adds 30–50 MB RSS per pod, and we already pay the cost of one Envoy per
instance (the credential gateway, ADR-033). Ambient runs at the node, not
per-pod, so the gateway pod's existing Envoy stays as-is. Ambient is also
the direction Istio is taking for new installs.

**`cert-manager-istio-csr`** to chain Istio's workload certs to a
cert-manager-issued root. Rejected for now: orthogonal to the auth
problem; clean follow-up if a unified PKI is ever desired.

## Consequences

- **Visible breakage fixed.** MCP and pod-files SSE return real responses
  instead of 404. The pod-files-SSE 401 retry loop ends. `/internal/trigger`
  gains real auth (it had none).
- **No credential exists.** The agent pod still has
  `automountServiceAccountToken: false` and holds zero token bytes.
  Workload identity in ambient is independent of the SA token mount —
  ztunnel uses the SA assignment from the pod spec, not a mounted token.
- **One PKI per concern.** Cert-manager keeps issuing the per-instance
  Envoy MITM leaf certs (ADR-033). Istio's istiod issues SPIFFE workload
  certs. The two PKIs serve different problems (intra-mesh identity vs
  upstream impersonation) and don't overlap.
- **Cluster dependency.** istiod, istio-cni, ztunnel DaemonSet, and a
  waypoint pod for the api-server. Documented as a deployment
  prerequisite alongside cert-manager. Local k3s installs get them via
  `mise run cluster:install`.
- **Service split.** Two Services per api-server release:
  `<release>-apiserver` (http + ext-authz) and
  `<release>-apiserver-harness` (harness, waypoint-attached). The
  controller's `PLATFORM_HARNESS_SERVER_URL` points at the new Service.
- **Per-instance SA churn.** One K8s API write per instance create
  (equivalent to per-instance Secret churn in any token-based scheme).
  Owner-refed to the instance CM; K8s GC reaps it on instance deletion.
- **kubeconform schema gap.** Istio's `AuthorizationPolicy` and
  `gateway.networking.k8s.io/v1.Gateway` aren't in kubeconform's bundled
  schema set. `helm:check:render` adds both kinds to the skip list,
  matching how cert-manager kinds were already handled.
- **ext_authz untouched.** Gateway → api-server identity stays
  pod-IP-resolver-based. Scope here is agent → api-server only; gateway
  pods don't hold harness-port credentials, the resolver works, and a
  waypoint hop on ext-authz adds latency for no security gain. Per-instance
  SA on gateway pods does future-proof a swap if ever wanted.

## Related ADRs

- [ADR-005](005-credential-gateway.md) — pattern preserved.
- [ADR-033](033-envoy-credential-gateway.md) — Envoy MITM unchanged;
  cert-manager keeps its role.
- [ADR-035](035-unified-hitl-ux.md) — ext_authz path unchanged.
- [ADR-038](038-paired-gateway-pod.md) — pair labels remain the L4
  isolation primitive; per-instance SA layered on top.
