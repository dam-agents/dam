# ADR-039: Istio ambient mesh for agent → platform identity

**Date:** 2026-05-06
**Status:** Accepted
**Owner:** @pilartomas

## Context

The api-server's harness port (`/api/instances/:id/mcp`,
`/api/instances/:id/pod-files/events`, `/internal/trigger`) needs
cryptographic identity. NetworkPolicy admits agent pods but cannot prove
*which* instance is calling, so a compromised pod could impersonate any
other.

A bearer-token shape would work but pulls a long-lived credential into a
pod the harness can already coexist with, and either expands Keycloak's
role to a per-call control-plane identity authority or invents a new
issuer. A workload-identity shape avoids the credential entirely:
identity becomes a property of where the pod runs.

## Decision

Adopt **Istio ambient mesh** with a **per-instance ServiceAccount** as
the auth primitive for agent → api-server harness traffic. Both pods of
the long-lived pair (agent + gateway) and every per-turn fork pair
targeting an instance run as that instance's SA — so the SPIFFE peer
principal SA name equals the URL `:id` the request addresses.

- **SA scoped per instance**, not per pair. Pair-keyed isolation stays
  on `LabelPair` NetworkPolicies (ADR-038) — sharing a SA across the
  agent/gateway pair doesn't weaken that. Forks reuse the parent's SA so
  the URL-keyed cross-check is identity equality for both shapes.
- **Waypoint in front of the harness Service.** Pure L4 ambient does not
  surface peer identity to the application — ztunnel forwards plaintext
  bytes after HBONE termination. A waypoint
  (`gatewayClassName: istio-waypoint`) terminates HBONE and emits
  `x-forwarded-client-cert` carrying the SPIFFE URI. The api-server
  parses it, validates trust domain + namespace, and rejects requests
  whose SA name does not match the URL `:id`.
- **Service split** to keep ext-authz off the waypoint. Existing
  api-server Service keeps `http` + `ext-authz` (direct, no waypoint).
  A new harness-only Service carries `istio.io/use-waypoint`. ext_authz
  identification continues to use the pod-IP resolver — a swap is risk
  for no benefit there, since gateway pods hold no harness credentials.
- **AuthorizationPolicy on the waypoint** as a defense-in-depth
  pre-filter (`source.namespaces == agent namespace`). The URL-keyed
  cross-check stays at the app layer where it belongs.
- **Istio is not bundled in the platform chart.** It installs separately
  (cluster install task on local; out-of-band on prod), mirroring how
  cert-manager is treated. The chart only carries consumer-side
  resources, gated by `istio.enabled`.

## Alternatives Considered

**Keycloak M2M (client_credentials).** Per-instance Keycloak client; the
gateway pod exchanges `client_id + client_secret` for a short-lived JWT.
Rejected: lifecycle spans two control planes (instance reconcile must
also reconcile a Keycloak client + secret); the long-lived `client_secret`
still has to live somewhere the harness cannot read; Keycloak's role
expands from user IdP to the identity authority for every internal call.
The standards/federation wins only matter when something off-cluster
needs to authenticate, which is not on the roadmap.

**Per-pair SA** (one SA per pair-key). Rejected: forks have a pair-key
distinct from the parent instance, so the SPIFFE SA name would not equal
the URL `:id` and the cross-check would need a side lookup. Per-instance
SA collapses that to identity equality. Per-pair revocation buys nothing
over pod deletion (forks are per-turn pods).

**Istio sidecar mode** instead of ambient. Rejected: 30–50 MB RSS per
pod on top of the existing Envoy credential gateway (ADR-033); ambient
runs at the node so the gateway's Envoy is unaffected.

**`cert-manager-istio-csr`** to chain Istio's workload certs to a
cert-manager root. Orthogonal to this decision; clean follow-up if a
unified PKI is ever wanted.

## Consequences

- The agent pod stays credential-free: `automountServiceAccountToken:
  false` is preserved; ambient identity is independent of the SA token
  mount.
- Two PKIs cohabit: cert-manager continues to issue per-instance Envoy
  MITM leaf certs (ADR-033); istiod issues SPIFFE workload certs. They
  serve different problems and do not overlap.
- New cluster dependency: istiod, istio-cni, ztunnel DaemonSet, and one
  waypoint pod per api-server release. Documented as a deployment
  prerequisite alongside cert-manager.
- Per-instance SA churn: one K8s API write per instance create,
  owner-refed to the instance CM; K8s GC reaps it on deletion.
- Two Services per api-server release; the controller stamps the new
  harness Service DNS into agent pod env so the waypoint is on-path for
  harness traffic and off-path for ext-authz.
- ext_authz remains gateway → api-server with the pod-IP resolver. A
  later swap to peer-principal there is mechanical because gateway pods
  already run as the per-instance SA.

## Related ADRs

- [ADR-005](005-credential-gateway.md) — credential-gateway pattern preserved.
- [ADR-033](033-envoy-credential-gateway.md) — Envoy MITM unchanged.
- [ADR-035](035-unified-hitl-ux.md) — ext_authz path unchanged.
- [ADR-038](038-paired-gateway-pod.md) — pair labels remain the L4 isolation primitive; per-instance SA layered on top.
