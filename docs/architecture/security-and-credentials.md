# Security and credentials

Last verified: 2026-05-06

## Motivated by

- [ADR-005 — Gateway pattern for credentials](../adrs/005-credential-gateway.md) — the agent never sees a real upstream token; a gateway injects them on the wire
- [ADR-015 — Multi-user authentication via Keycloak](../adrs/015-multi-user-auth.md) — Keycloak is the IdP; resources are owner-labelled
- [ADR-018 — Slack integration](../adrs/018-slack-integration.md) — identity linking and the per-instance `allowedUsers` gate that decides who can drive a thread
- [ADR-027 — Slack per-turn user impersonation](../adrs/027-slack-user-impersonation.md) — foreign repliers fork the instance into a per-turn paired pod whose gateway mounts the replier's K8s credential Secrets
- [ADR-033 — Envoy-based credential gateway](../adrs/033-envoy-credential-gateway.md) — Envoy mints per-instance leaf certs, MITMs egress, and injects credential headers
- [ADR-035 — HITL ext_authz](../adrs/035-hitl-ext-authz.md) — Envoy gates credentialed egress through an api-server ext_authz call
- [ADR-038 — Paired agent and gateway pods](../adrs/038-paired-gateway-pod.md) — agent and gateway run in two paired pods, with NetworkPolicies the cluster enforces

## Overview

Three rules carry the security model:

1. **Agents never hold upstream credentials.** Real upstream tokens (GitHub,
   Anthropic, Slack, internal gateways) live in K8s Secrets labelled with the
   owner's `sub`. The Envoy proxy in the paired gateway pod injects them
   into outbound traffic on the wire — the agent pod never mounts Secret
   bytes.
2. **Identity flows from Keycloak.** Browser users authenticate against
   Keycloak; the api-server validates the JWT and stamps `platform.ai/owner` on
   every resource the user creates. Per-user credential isolation is the
   `platform.ai/owner` label on the K8s Secret — the controller's selector
   refuses to mount any other owner's Secret into a given owner's gateway pod.
3. **The trust line is the agent pod's network egress, enforced by the
   cluster.** Each instance runs as two paired pods (ADR-038): an `agent` pod
   and a `gateway` pod, glued by role-scoped NetworkPolicies. The agent pod
   has no admitted egress to TCP 80/443 anywhere except its paired gateway
   pod's proxy port; the gateway pod accepts ingress only from its paired
   agent. The agent's `HTTPS_PROXY` value points at the per-instance
   gateway Service DNS, but obeying it is no longer a requirement —
   Kubernetes admits no other route. Envoy in the gateway pod enforces what
   each grant actually permits on the wire and gates each credentialed
   request through the ext_authz handler.

Workspace contents are explicitly outside the trust boundary — see the
security note on [persistence](persistence.md).

## Diagram

```mermaid
flowchart LR
  browser[browser]

  subgraph platform[Platform plane]
    api-server
    controller
    keycloak[Keycloak]
  end

  subgraph agentpod[Agent pod]
    agent-runtime
  end

  subgraph gatewaypod[Gateway pod]
    envoy[Envoy]
  end

  external[external services]

  browser -->|user JWT| api-server
  api-server -->|JWKS validate| keycloak

  api-server -->|write K8s Secrets<br/>platform.ai/owner=sub| gatewaypod
  controller -->|render bootstrap + leaf cert<br/>list owner Secrets| gatewaypod
  controller -->|render agent + paired gateway<br/>+ role-scoped NetworkPolicies| agentpod

  agent-runtime -->|HTTPS_PROXY=&lt;instance&gt;-gateway| envoy
  envoy -->|ext_authz Check| api-server
  envoy -->|inject credentials| external
```

The credential boundary is the pod: K8s Secrets are mounted into the
gateway pod only, and the agent pod has no admitted route to TCP 80/443
other than its paired gateway. The agent pod has no service account token
(`automountServiceAccountToken: false`), and there is no co-located
sidecar to share a network or PID namespace with. See
[ADR-033 §Threat Model](../adrs/033-envoy-credential-gateway.md#threat-model)
and [ADR-038 §Threat Model](../adrs/038-paired-gateway-pod.md#threat-model).

## Identity

**Keycloak** is the only identity authority. It runs in-cluster as a Helm
subchart and is the OIDC provider for every authenticated surface. The
user agent flow:

1. Browser authenticates against Keycloak and obtains a JWT with audience
   `platform-api`.
2. UI sends the JWT to the api-server on every tRPC and ACP call. The
   api-server validates it against Keycloak's JWKS.
3. The api-server's `sub` claim becomes `platform.ai/owner=<sub>` on every
   resource the user creates (instance ConfigMap, K8s credential Secret,
   etc.).

There is no token exchange — credential storage is K8s-native and label-
scoped, so the api-server enforces ownership directly when reading and
writing.

## Resource ownership

Multi-tenancy is **soft** — a single Kubernetes namespace, with a
`platform.ai/owner` label on every owned resource carrying the authenticated
user's `sub`. The api-server is the sole writer of `spec.yaml` and stamps
the label on create; every list and get filters by it. There is no
namespace-per-user.

The controller picks credentials per-instance by listing K8s Secrets
labelled `platform.ai/owner=<sub>,platform.ai/managed-by=api-server` in the agent
namespace, then mounting the matching set into the paired gateway pod. Cross-
owner leakage is structurally prevented by the label selector — a missing
`platform.ai/owner` label is treated as no owner and never mounted.

## Credential storage

Each connected service produces one K8s Secret per `(owner, connection)`:

- **OAuth-issued tokens** (GitHub, MCP servers, Generic OAuth apps) — the
  api-server's `/api/oauth/callback` writes the access + refresh token
  pair, with an `platform.ai/host-pattern` annotation naming the upstream
  host the token belongs to. The refresh-token loop re-mints access
  tokens before expiry; the agent never sees the refresh token.
- **User-supplied secrets** (Anthropic API keys, generic API tokens) —
  the secrets module writes them with the same labels and annotations.

The Secret carries the SDS YAML Envoy reads via its `path_config_source`.
Only the gateway pod mounts the Secret; the agent pod does not. See
[`packages/api-server/src/modules/connections/infrastructure/k8s-connections-port.ts`](../../packages/api-server/src/modules/connections/infrastructure/k8s-connections-port.ts) and
[`packages/api-server/src/modules/secrets/infrastructure/k8s-secrets-port.ts`](../../packages/api-server/src/modules/secrets/infrastructure/k8s-secrets-port.ts).

## Envoy credential injection

The controller renders a per-instance `Envoy bootstrap ConfigMap` and a
cert-manager `Certificate` whose Secret holds the leaf TLS material the
gateway pod uses to terminate the agent's egress TLS. The leaf is
issued by a chart-managed `platform-mitm-ca-issuer` ClusterIssuer; the CA
cert is mounted into the agent at `/etc/platform/ca/ca.crt` (single-key
projection, `tls.key` stays in the gateway pod) so the agent's TLS
clients trust Envoy's intercept cert.

On the wire:

1. Agent sets `HTTPS_PROXY=http://<instance>-gateway:<envoyPort>`. The
   per-instance gateway Service routes the connection to the paired
   gateway pod; every egress arrives there as HTTP CONNECT.
2. Envoy's outer listener (bound on `0.0.0.0`, reach gated by
   NetworkPolicy) terminates the CONNECT and routes the inner stream
   into an internal listener that reads SNI.
3. Per-host filter chains terminate TLS with the leaf cert, run the
   credential injector to add the configured `Authorization` header, then
   forward to a per-credential `STRICT_DNS` cluster pinned to the
   credential's host (explicit upstream SNI + SAN-bound TLS validation).
   The agent's inner `Host` header has no influence on the upstream
   destination — the route-confusion exfiltration path from
   [ADR-033 §Threat Model](../adrs/033-envoy-credential-gateway.md#threat-model)
   is structurally closed. Allow-only chains (path-rule promoted, no
   credential) keep using the dynamic forward proxy — they have no
   credential to misroute.
4. The default chain (SNI miss) does TCP passthrough — the request reaches
   the upstream unchanged.

Hosts the api-server has issued a credential for surface as L7 chains (SNI
match, header injection); hosts with no credential surface as L4
passthrough chains.

## HITL ext_authz

Each credentialed request goes through an ext_authz Check call against
the api-server. The handler resolves the source pod IP — under the
paired-pod model that's the gateway pod's IP, narrowed by the resolver
filter `agent-platform.ai/instance, agent-platform.ai/role=gateway` — to
an instance, looks up the matching egress rule, and either allows the
request, denies it, or holds it open while the user makes a verdict in
the inbox (ADR-035). `failure_mode_allow: false` — a blocked Check fails
closed: agent gets 403, no inbox prompt.

NetworkPolicy admits ext_authz traffic only from gateway pods to the
api-server's gRPC listener. The HTTP filter on TLS-terminated chains
sees method/path; the network filter on the catch-all chain sees SNI
only.

## Per-turn fork pods (Slack foreign replier)

When a user other than the instance owner replies in a Slack thread,
the api-server emits a fork ConfigMap that the controller materialises
into a per-turn paired pod set: a fork agent Job and a fork gateway Pod
(ADR-038). The fork's gateway pod mounts the **replier's** K8s credential
Secrets — selected by `platform.ai/owner=<replier-sub>`, not the instance
owner's `sub`. The credential boundary is preserved: the fork pair runs
the replier's credentials, never the parent instance owner's. The fork
agent's `agent-platform.ai/instance` label still points at the parent
instance so traffic resolves under the parent's egress rules; the fork's
own pair key (`agent-platform.ai/pair`) isolates it from the parent
instance's pair. See [ADR-027](../adrs/027-slack-user-impersonation.md)
and [ADR-038](../adrs/038-paired-gateway-pod.md).

## Network policy

Each instance and each fork get **two** NetworkPolicies, role-scoped on
`agent-platform.ai/pair=<pair-key>`. The agent pod's policy:

- Admits egress to the paired gateway pod's proxy port — exact-match on
  `pair + role=gateway`.
- Admits egress to the api-server's harness port (MCP, triggers).
- Admits DNS.
- **Does not** admit egress to TCP 80/443 anywhere — that's the bypass the
  paired-pod split closes (ADR-038).
- Admits ingress on the agent's ACP/tRPC port only from the api-server pod;
  the kernel-level peer match is the auth boundary on that hop.

The gateway pod's policy:

- Admits egress on TCP 80/443 anywhere (Envoy reaches arbitrary upstreams;
  ADR-033 §Decision keeps the first-cut allowlist permissive).
- Admits gRPC egress to the api-server's ext_authz port (the HITL gate).
- Admits DNS.
- Admits ingress on the proxy port only from the paired agent pod —
  exact-match on `pair + role=agent`. Loosening to a wildcard would let
  one pair's agent dial another's gateway.
