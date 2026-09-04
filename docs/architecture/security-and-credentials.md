# Security and credentials

Last verified: 2026-09-04

## Overview

Three rules carry the security model:

1. **Agents never hold upstream credentials.** Real upstream tokens (GitHub,
   Anthropic, Slack, internal gateways) live in K8s Secrets labelled with the
   owner's `sub`. The Envoy proxy in the paired gateway pod injects them
   into outbound traffic on the wire — the agent pod never mounts Secret
   bytes.
2. **Identity flows from Keycloak.** Browser users authenticate against
   Keycloak; the api-server validates the JWT and stamps `agent-platform.ai/owner` on
   every resource the user creates. Per-user credential isolation is the
   `agent-platform.ai/owner` label on the K8s Secret — the controller's selector
   refuses to mount any other owner's Secret into a given owner's gateway pod.
3. **Two boundaries, layered.** The agent → gateway hop is gated at the
   *kernel* by a per-pair NetworkPolicy;
   the gateway → api-server hops (harness and ext-authz) are gated at
   the *mesh* by per-Agent Istio AuthorizationPolicies on the
   gateway pod's SPIFFE principal.
   The agent pod opts out of ambient mesh (`istio.io/dataplane-mode:
   none`) so the kernel sees real destinations rather than HBONE
   tunnelled to ztunnel; its only admitted intra-cluster destination
   is the paired gateway pod on the Envoy proxy port. The gateway pod
   stays in ambient; istiod stamps it with a SPIFFE workload cert whose
   SA name equals the Agent name. Two per-Agent
   AuthorizationPolicies enforce the gateway-originated boundary
   cryptographically: the api-server's harness waypoint ALLOWs the
   gateway principal to `/api/agents/<id>/*`; the per-Agent
   ext-authz Service ALLOWs only the matching SA.

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

  api-server -->|write K8s Secrets<br/>agent-platform.ai/owner=sub| gatewaypod
  controller -->|render bootstrap + leaf cert<br/>list owner Secrets| gatewaypod
  controller -->|render agent + paired gateway<br/>+ per-pair agent egress NetworkPolicy<br/>+ harness/ext-authz AuthorizationPolicies| agentpod

  agent-runtime -->|HTTPS_PROXY=&lt;agent&gt;-gateway| envoy
  envoy -->|ext_authz Check| api-server
  envoy -->|inject credentials| external
```

The credential boundary is the pod: K8s Secrets are mounted into the
gateway pod only, and the agent pod has no admitted route to TCP 80/443
other than its paired gateway. Enforcement is layered:

- **Per-pair agent egress NetworkPolicy** (controller-rendered,
  `<id>-agent-egress`) is the sole gate on the agent → paired gateway
  hop. The agent pod opts out of ambient mesh, so the kernel sees real
  destination IPs rather than HBONE tunnelled to ztunnel; the policy
  admits exactly DNS and the paired gateway pod's Envoy port. HBONE
  15008 is not admitted — the agent never speaks it.
- **Agent ingress NetworkPolicy** (chart-rendered,
  `agent-ingress-platform-only`) admits ingress to the agent port only
  from the api-server (ACP/tRPC relay) and the controller (idle-checker
  busy-probe). agent-runtime serves unauthenticated on the assumption
  that this kernel gate is the auth boundary; kubelet probes are
  node-originated and unaffected.
- **Gateway Envoy ext_authz** gates everything the gateway
  forwards on behalf of the agent — external upstreams via the HITL
  rule model, while platform-internal upstreams pass without a
  per-request human decision: the harness path (control-plane traffic
  to the api-server) and the artifact object store, where each
  request already carries a platform-minted authorization — a
  short-lived link scoped to a single object and operation, issued by
  the api-server after ownership checks and validated by the store
  itself ([artifact-library](artifact-library.md)). This is
  the destination-side egress gate; no NetworkPolicies on Postgres /
  Redis / Keycloak / the harness or ext-authz Services are needed
  because the agent has no admitted route to any of them.
- **Mesh AuthorizationPolicy** gates the gateway-originated
  hops by the gateway pod's SPIFFE principal: harness via the
  api-server's waypoint, ext-authz on the per-Agent Service. The
  agent has no SPIFFE identity in this model.

The agent pod has no service account token
(`automountServiceAccountToken: false`), and there is no co-located
sidecar to share a network or PID namespace with.

## Identity

**Keycloak** is the only identity authority. It runs in-cluster as a Helm
subchart and is the OIDC provider for every authenticated surface.

Keycloak's branded login page ships two presentation variants selected
per deployment: password-first (the default — username/password form,
with any identity-provider buttons offered below it) and SSO-first
(identity-provider CTAs only, for deployments where corporate SSO is the
expected sign-in path; the page falls back to the password form when the
realm has no identity provider configured). The chart's `keycloak.login`
values ([`deploy/helm/platform/values.yaml`](../../deploy/helm/platform/values.yaml))
select the variant and an optional "Request access" link; switching
variants is a values change and a pod roll — no theme rebuild, no realm
change. The same page also knows which client started the sign-in: when
it is the artifact share host's client (`keycloak.shareClientId`), the
heading and lead paragraph tell the visitor they need to sign in to view
a shared artifact instead of the general product pitch. Upstream identity
providers themselves (e.g. w3id) are realm configuration managed outside
the chart.

The user agent flow:

1. Browser authenticates against Keycloak and obtains a JWT with audience
   `platform-api`.
2. UI sends the JWT to the api-server on every tRPC and ACP call. The
   api-server validates it against Keycloak's JWKS.
3. The api-server's `sub` claim becomes `agent-platform.ai/owner=<sub>` on every
   resource the user creates (Agent CR, K8s credential Secret,
   etc.).

The realm holds a **second public client** for the artifact share host
([artifact-library](artifact-library.md#the-share-host--trust-boundary)):
PKCE-only, redirect pinned to that host's sign-in callback, and no
`platform-api` audience, so its tokens are rejected by the api-server. A
restricted-link viewer thus gets an identity on the share origin without
the app's tokens ever being valid there.

Two interstitials can take the browser off the page the user asked for:
the login redirect above, and the Terms-of-Use gate. Both park that
destination and resume it once cleared, so a deep link survives them —
an in-chat bind link ([channels](channels.md)) is single-use, so losing
its target would cost the user a fresh bind command rather than a retry.

If the key set itself cannot be retrieved (Keycloak unreachable, fetch
timeout, non-200 response), verification fails closed with **503** and
reason `jwks-unavailable` — never 401: a transient infrastructure failure
is signalled as retryable, not as a credential rejection. Every
token-validity failure (expired, bad signature, unknown `kid`, wrong
audience) remains 401. The api-server also warms the JWKS at boot and
gates its readiness probe on the first successful fetch, so a rolling
update keeps the previous pod serving until the new pod can verify
tokens. The warm-up gives up after a bounded window (so a prolonged
Keycloak outage cannot wedge a rollout indefinitely): past that, the pod
reports ready and serves 503s on authenticated routes until Keycloak is
reachable again.

There is no token exchange — credential storage is K8s-native and label-
scoped, so the api-server enforces ownership directly when reading and
writing.

For headless / CI use, the CLI accepts a long-lived **API key** in the
same `Authorization: Bearer` slot, distinguished by a `pk_` prefix. API
keys carry the owner's `sub`, a subset of permission scopes, and an
optional agent allowlist; the bearer middleware dispatches by prefix and
produces the same downstream authenticated-principal shape — sub, scopes,
agent binding, and an optional key id. API keys cannot mint or revoke
other API keys — the management surface rejects any request whose
principal was authenticated via a key, so exfiltrated keys cannot
escalate.

## Keycloak event logging

Keycloak is also an audit event source. It emits login and admin events
to pod stdout via its built-in `jboss-logging` event listener, so they
ride the same cluster log pipeline as every other pod log out to the
external log service. Successes surface at `info`, errors at `warn`, as
structured JSON in production.

Persistence is split by event class:

- **Login events** (LOGIN, LOGOUT, LOGIN_ERROR, token refresh, account
  changes, …) are *not* written to the Keycloak database. The listener
  fires independently of DB-store gating, so the events still reach
  stdout; the external log service is the source of truth for the
  authentication audit trail, and Postgres is spared the high-volume
  write.
- **Admin events** (any change made through the admin REST API or
  console) fire on the same listener, so their metadata — who acted, on
  which resource, from where — reaches stdout and the external log
  service alongside login events. That metadata is also recorded to
  Postgres (low volume), but the full request body is *not*
  (`adminEventsDetailsEnabled` is off): stored bodies would otherwise
  capture sensitive payloads — plaintext credentials on user-create /
  user-update flows — and Keycloak retains admin events indefinitely with
  no built-in expiration. The log line never carries the request body, so
  the external log pipeline, not the Keycloak database, is the audit
  source of truth.

The event knobs, log format, and realm import live in the Keycloak Helm
values under [`deploy/helm/platform/`](../../deploy/helm/platform/).

## Resource ownership

Multi-tenancy is **soft** — a single Kubernetes namespace, with a
`agent-platform.ai/owner` label on every owned resource carrying the authenticated
user's `sub`. The api-server is the sole writer of resource spec and stamps
the label on create; every list and get filters by it. There is no
namespace-per-user.

The controller picks credentials per-Agent by listing K8s Secrets
labelled `agent-platform.ai/owner=<sub>,agent-platform.ai/managed-by=api-server` in the agent
namespace, then mounting the matching set into the paired gateway pod. Cross-
owner leakage is structurally prevented by the label selector — a missing
`agent-platform.ai/owner` label is treated as no owner and never mounted.

## Credential storage

Each connected service produces one K8s Secret per `(owner, connection)`:

- **OAuth-issued tokens** (GitHub, MCP servers, Generic OAuth apps) — the
  api-server's `/api/oauth/callback` writes the access + refresh token
  pair plus a structured **host list** describing every wire position
  the token should be injected on. The refresh-token loop re-mints
  access tokens before expiry; the agent never sees the refresh token.
  Re-running login and consent against an existing connection replaces its
  tokens in place, keeping the connection's identity and grants. When the
  connection stores the OAuth app's *client* secret itself (rather than
  inheriting the deployment's), that secret is replaceable in place too — the
  api-server immediately tries the stored refresh token with it, so a rotation
  upstream usually revives the connection with no user consent at all, and where
  it can't, re-authentication is unblocked by it. A client secret supplied by the
  operator is deploy config and is rotated there.
- **User-supplied secrets** (Anthropic API keys, generic API tokens) —
  the Connections subsystem writes them as a **header Connection** per
  credential, built from its template and stored with the same labels and
  annotations: one per-Connection Secret carrying the credential value plus
  the placeholder SDS the gateway reads.
- **Client-credentials grants** (machine-to-machine OAuth) — the
  per-Connection Secret stores the long-lived client secret, and the
  api-server exchanges it at the provider's token endpoint (discovered from
  the issuer's OAuth metadata at connect time) for short-lived access
  tokens: once synchronously at connect time (bad credentials fail the
  create), then again before each expiry via the same refresh loop that
  renews OAuth tokens. Only the minted access token reaches the gateway's
  injection path; the client secret stays at rest and is never sent to the
  connection's hosts. The stored client secret is replaceable in place when it
  rotates upstream — the api-server mints with the new one before writing it, so
  a wrong secret is rejected rather than stored.
- **GitHub personal access tokens** — a PAT is one **`github-pat`
  Connection** whose template re-bakes, from the bare PAT, every GitHub
  host injection it needs into a single per-Connection Secret — `Bearer`
  on the API and raw-content hosts, `Basic`-encoded on the git host for
  `git clone` over HTTPS — plus a `GH_TOKEN` env contribution for the
  `gh` CLI. (This is the multi-host-injection shape described next, with
  the `Basic`-encoded half generated by the template rather than typed by
  the user.) The `github-enterprise-pat` variant bakes the same shape from
  the user's enterprise host, plus a `GH_HOST` env contribution.
- **GitHub App installation tokens** — a `github-app` Connection stores the
  app's PEM private key and mints short-lived installation tokens (`ghs_…`)
  from it, the JWT-signed counterpart of the client-credentials grant above:
  the api-server signs a short-lived app JWT, exchanges it at GitHub's
  installation-token endpoint (once at connect, then before each expiry via
  the same refresh loop), and re-bakes the same three GitHub host injections
  as the PAT template. The private key stays at rest and is never sent to any
  host; only the installation token reaches the gateway's injection path. Like
  the client secret above, a rotated private key is pasted in place and proven by
  minting before it is stored.

  A Connection may additionally **narrow the authority of the token it mints**,
  below what the app installation itself holds — to a chosen set of repositories,
  to a chosen set of permissions, or both. An installation is an
  organization-wide grant, typically far broader than any one agent's task, and
  narrowing is how one broadly-installed app backs many least-privilege
  Connections without a second app per task. GitHub is the arbiter: it refuses
  any request exceeding the installation, so the narrowing can only ever reduce
  authority, never claim it. The chosen subset is **part of the credential's
  stored identity, not a one-time argument** — every renewal and every key
  rotation re-mints against the same subset, so a Connection cannot silently
  widen back to the whole installation between renewals. Narrowing is opt-in:
  a Connection that names no subset carries the installation's full authority,
  which is what every Connection made before the capability existed does. Once
  a subset stops being covered — the organization drops a repository from the
  installation, or revokes a permission — renewal is *rejected* rather than
  merely failing, so the Connection reads expired and waits for someone to
  widen the installation or narrow the Connection, instead of retrying a
  request that cannot succeed.

  The subset is chosen against **what the installation actually grants, read
  back from GitHub** before the Connection is created: the api-server
  authenticates as the app, asks what the installation holds, and offers those
  repositories and permissions to choose from. So narrowing is a selection
  rather than a guess, and a permission can be taken at a *lower* level than
  the installation holds it — the read-only agent on a read-write installation
  is the case that motivates this, and it cannot be expressed by picking whole
  permissions alone. Repositories chosen this way are remembered by GitHub's
  identifier rather than by name, so renaming one does not quietly turn a
  working Connection into a rejected renewal. The read needs the app's private
  key and is authenticated the same way minting is; it stores nothing.

  The subset is **editable in place**, which is the one part of a Connection's
  configuration that is: what an agent should be allowed to do changes as its
  work does, and rebuilding the Connection to add a repository would mean
  re-pasting the key and re-granting it to every agent. Editing re-reads the
  installation using the Connection's own stored key — never asking for it a
  second time — and re-mints immediately, so the narrower token replaces the
  live one rather than waiting out the current one's hour. The new subset is
  proven by that mint before it is stored, so one the installation cannot
  cover fails the edit instead of parking the Connection at its next renewal.
  Nothing else moves: the credential, the contributions, and every agent grant
  are untouched, and because the token is read gateway-side the change lands
  without an Agent-spec patch or a pod roll.

**Multi-host connections.** A single OAuth connection can inject the
same token on more than one host with **different auth schemes per
host**, all from one K8s Secret. The Secret carries a JSON
`agent-platform.ai/injection-hosts` annotation listing each
`{host, headerName?, valueFormat?, encoding?, pathPattern?}` tuple; the
controller fans the Secret into one Envoy filter chain per host —
entries that share a host stack into that chain as an ordered list of
credential injectors (see *Multiple injection steps per host* below) —
mounting the Secret once and reading one SDS file per injection step
inside it. The same list drives the egress allowlist (one
`connection:<id>` rule per host) — there is no second source of truth.

GitHub.com is the motivating case ([issue #219](https://github.com/dam-agents/dam/issues/219)):
the same OAuth token must reach `api.github.com` as
`Authorization: Bearer …`, `github.com` as
`Authorization: Basic base64("x-access-token:<token>")` (so `git clone`
of private repos works without a credential helper), and
`raw.githubusercontent.com` as `Bearer` again (raw-file fetches).

The Secret carries the SDS YAML Envoy reads via its `path_config_source`.
Only the gateway pod mounts the Secret; the agent pod does not. See
[`packages/api-server/src/modules/connections/infrastructure/`](../../packages/api-server/src/modules/connections/infrastructure/) and
[`packages/api-server/src/modules/connections/domain/connection-sds.ts`](../../packages/api-server/src/modules/connections/domain/connection-sds.ts).

## Image pull credentials

Pulling the agent's container image from a private registry uses a
**structurally separate** credential class from the egress credentials
above. It does not ride the Envoy path at all:

- **The kubelet consumes it, not Envoy.** It is a
  `kubernetes.io/dockerconfigjson` Secret referenced from the pod spec's
  `imagePullSecrets`; the kubelet reads it at pod creation to authenticate
  the image pull. It is never mounted into the gateway pod and never
  projected into the agent container — like egress credentials, the agent
  never holds the bytes, but here that is a property of *where the Secret
  is consumed* rather than of Envoy injection.
- **Scope is the Agent, not the owner.** Egress credentials are
  owner-scoped and reusable across every Agent that owner runs; a pull
  credential is agent-scoped — one Secret per Agent (still carrying the
  creator's `agent-platform.ai/owner` for tenancy), created with the Agent and
  torn down with it. There is no cross-agent reuse.
- **Per-agent precedence over the install-wide default.** An operator may
  configure an install-wide default pull secret applied to every agent
  pod. When an Agent carries its own pull-secret ref the controller lists
  it *first* on the pod's `imagePullSecrets`, ahead of the install-wide
  default, which is retained as a fallback — override, not replace.

The api-server builds the Secret from structured `{server, username,
password}` input and writes it before the Agent record, rolling it back if
that create fails. Teardown is a delete-time cleanup hook with a
label-scoped orphan sweep as backstop; lifetime detail lives on
[persistence](persistence.md). The credential is validated only at pull
time — a bad credential surfaces as an image-pull failure on the pod, not
a create-time error.

Scope is long-lived static credentials (registry PAT, robot account, basic
auth, a GCP Artifact Registry JSON key as the password). Short-lived or
dynamically-minted registry tokens (e.g. ECR) are out of scope.

## Platform database roles

The credentials above are *upstream* secrets the platform injects on behalf of
agents. The platform's own backing store has a separate credential boundary: the
bundled Postgres splits application connection identities from DBA authority.
Three login roles, not one:

- **`platform_apiserver`** / **`platform_keycloak`** — `NOSUPERUSER` owners of
  the `platform` and `keycloak` databases respectively, each the only role its
  service connects as. `CONNECT` is revoked from `PUBLIC` and granted back only
  to that owner, plus the credential-less `usage_readers` group on `platform`
  ([usage-tracking](usage-tracking.md#source-passthrough-views)), so a leaked
  api-server credential can neither read Keycloak's
  database nor escalate (no `CREATE ROLE`, no `ALTER SYSTEM`, no RLS bypass) —
  it can only do DDL/DML within the `platform` database it already owns.
- **`platform`** — the lone `SUPERUSER`, used only for DBA work. It is the
  image's bootstrap superuser, because Postgres forbids demoting that role and
  so it must be the role that is *allowed* to keep SUPERUSER, not an app role.
  An existing single-role cluster already bootstrapped under this name, so it is
  kept in place rather than renamed — Postgres forbids renaming the role you
  are connected as. A per-role `log_statement` default puts every
  admin-session statement into the audit trail, and every role and grant
  change is audited whoever issues it ([persistence](persistence.md)).

The admin credential lives in the same `platform-postgres-secrets` Secret and
must be treated as high-value. The statement audit is best-effort, not enforced
— a superuser session can `SET log_statement` mid-session. Operational details are in the
[runbook](../notes/postgres-role-operations.md).

## Envoy credential injection

The controller renders a per-Agent `Envoy bootstrap ConfigMap` and a
cert-manager `Certificate` whose Secret holds the leaf TLS material the
gateway pod uses to terminate the agent's egress TLS. The leaf is
issued by a chart-managed `platform-mitm-ca-issuer` ClusterIssuer; the CA
cert is mounted into the agent at `/etc/platform/ca/ca.crt` (single-key
projection, `tls.key` stays in the gateway pod) so the agent's TLS
clients trust Envoy's intercept cert.

On the wire:

1. Agent sets `HTTPS_PROXY=http://<agent>-gateway:<envoyPort>`. The
   per-Agent gateway Service routes the connection to the paired
   gateway pod; every egress arrives there as HTTP CONNECT.
2. Envoy's outer listener (bound on `0.0.0.0`, reach gated by
   NetworkPolicy) terminates the CONNECT and routes the inner stream
   into an internal listener that reads SNI.
3. Per-host filter chains terminate TLS with the leaf cert, run the
   credential injector(s) to add the configured header(s) (or rewrite
   `?<param>=<value>` into the URL — see below), then forward to a
   per-chain `STRICT_DNS` cluster pinned to the host (explicit upstream
   SNI + SAN-bound TLS validation). The agent's inner `Host` header has
   no influence on the upstream destination — the route-confusion
   exfiltration path is structurally closed. Allow-only chains
   (path-rule promoted, no
   credential) keep using the dynamic forward proxy — they have no
   credential to misroute.
4. The default chain (SNI miss) does TCP passthrough — the request reaches
   the upstream unchanged.

Hosts the api-server has issued a credential for surface as L7 chains (SNI
match, header injection); hosts with no credential surface as L4
passthrough chains.

**L7 promotion.** An egress rule that narrows a host by path, method, or
port is invisible to the L4 catch-all (it sees only SNI), so the rule's
host must be *promoted* onto a TLS-terminating chain to be enforceable
over HTTPS. The promotion signal is the Agent resource's `l7Hosts` spec
list. It is per-agent intent, exactly like connection grants: promoting a
host on one agent re-renders and rolls only that agent's gateway, never a
sibling's. Promoted hosts get an uncredentialed L7 chain (gate sees
method/path; nothing is injected) and extend the leaf certificate's SAN
list.

`l7Hosts` is a pure projection of the agent's active rules: the api-server
recomputes it from the rule set after every create, edit, and revoke and
writes it wholesale, so a host is demoted (dropped from interception) as
soon as its last narrowing rule is gone. A roll follows any change to that
set and nothing else, so the projection ships in the contract package:
clients predict an interruption with the server's own rule, not the rule's
shape. Connection-derived rules are excluded — their host is already
TLS-terminated by the connection's own credential chain. Because each
entry is interpolated into the gateway's Envoy bootstrap and cert SANs,
the CRD constrains list items to DNS hostnames, so a rule host cannot
inject config into the owner's gateway.
That projection is a second write to the Agent CR that cannot share a
transaction with the rule write, so a per-agent periodic reconcile
re-derives it from the rules — converging a host whose patch failed, or
whose api-server died between the rule commit and the patch, without
operator action.

A referenced SDS file missing from the mounted Secret is a fatal Envoy
boot error, so the controller verifies each credential's SDS key against
the Secret's data at render time and degrades that host to an allow-only
chain (logged as a warning) rather than emit an unbootable bootstrap.
Requests to the host then go out uncredentialed — failing upstream auth
for that host only — instead of crash-looping the whole gateway. Stale
Secrets written by since-replaced code paths are the known trigger.

That check covers a credential already known to be bad when the gateway is
rendered. A credential can also be revoked *after* it — disconnecting a
connection deletes its Secret, and a gateway roll already in flight can
carry the reference past the deletion. A Secret mount is mandatory, so
that pod never starts, and Kubernetes will not replace a pod that is not
ready with the corrected configuration that follows seconds later: the
gateway would keep its Service and lose all egress until an operator
deleted the pod. The controller therefore evicts gateway pods left
running a configuration it has already superseded, whatever wedged them,
and names that state on the gateway's readiness condition so it reads as
a failure being repaired rather than a slow start. Recovery costs a
normal gateway restart. The race itself is not closed — deletion is not
atomic with the roll — so the eviction, not the ordering, is what bounds
the harm.

A host's L7 chain can opt into HTTP/2 so credential injection also covers
gRPC request streams (e.g. Modal); hosts default to HTTP/1.1 unchanged.

**Non-443 upstreams and streaming.** Per-host injection descriptors can
carry three more chain-level attributes, motivating case being external
Kubernetes/OpenShift clusters ([issue #2314](https://github.com/dam-agents/dam/issues/2314)):

- **Upstream port** — the pinned cluster dials the declared port (default
  443) and the upstream sees a `host:port` authority. Only L7 chains honor
  ports: the SNI-miss L4 catch-all always dials 443, because a CONNECT's
  authority port is not recoverable after the tunnel handoff (SNI carries
  no port). Allow-only (uncredentialed) chains need no pinned port — they
  forward via the dynamic forward proxy, which honors the inner request's
  own `Host:port`.
- **Upgrade tunneling** — chains that opt in tunnel HTTP Upgrade flows
  (WebSocket, and SPDY/3.1 for older Kubernetes clients) instead of
  rejecting them, so `kubectl exec` / `port-forward` / `logs -f` work
  through the credential-injecting path. The credential rides the upgrade
  request itself and ext_authz gates it once; after the 101 the gateway
  splices bytes. Such chains also get a long tunnel idle timeout (matching
  the kubelet's own streaming default) instead of the 5-minute stream
  default. Upgrade chains stay HTTP/1.1 — upgrades don't survive an
  HTTP/2 upstream leg.
- **Private upstream CA** — a connection can carry the upstream's CA
  bundle in its K8s Secret; the chain validates the upstream handshake
  against it instead of the system trust store (self-signed cluster CAs),
  with SAN pinning unchanged. Agent-side trust is unaffected: the agent
  always trusts the platform MITM CA, never the upstream's.

**Multiple injection steps per host.** A single host can carry more than
one credential — either two different credentials (e.g. an API key and a
tenant ID on distinct headers) or the same credential injected into both
a header and a URL query parameter (e.g. Bob shell's `/key/info?key=…`
endpoint). The controller groups Secrets by `hostPattern` into one L7
chain with an ordered list of `credential_injector` filters; each step
must use a unique header name, and steps marked with `queryParamName`
get a follow-up Lua filter that moves the (bare, percent-encoded) value
into the named URL query parameter and strips the carrier header so it
never reaches the upstream.

## HITL ext_authz

Each credentialed request goes through an ext_authz Check call against
the api-server. Identity is the **per-Agent ext-authz
Service** the gateway pod's Envoy was configured to dial
(`<release>-extauthz-<id>`); the AuthorizationPolicy on each Service
ALLOWs only the matching SA principal, so by the time a Check arrives
the calling Agent is already proven cryptographically. The handler
parses the Agent ID from the gRPC `:authority`, looks up the matching
egress rule, and either allows the request, denies it, or holds it open
while the user makes a verdict on Home.
`failure_mode_allow: false` — a blocked Check fails closed: agent gets
403, no approval prompt. The pod-IP resolver and the `x-platform-agent`
header are gone.

The HTTP filter on TLS-terminated chains sees method/path; the network
filter on the catch-all chain sees SNI only.

**Unattended requests are refused, not held.** Holding is only worth
doing where a verdict can be made. A turn driven from a messenger
([channels](channels.md)) cannot produce one — the owner is not
necessarily present, and the conversation's other members are not the
owner — so a hold raised by such a turn would occupy the entire window
and deny anyway, with the turn silent throughout. So when the gate sees
a channel turn open on the agent and no interactive session attached to
answer for it, it records the request and denies at once. The record is
the point: it stays actionable on Home, a permanent verdict there
writes the rule the agent's next attempt consumes, and retries reuse
that one row instead of filing a copy each time. No in-session prompt
is published on this path — the only consumers are the relay clients
whose absence defines it. Both signals are read across api-server
replicas (the replica relaying a turn is rarely the one a Check lands
on) and fail toward *attended*, so losing them degrades to the ordinary
hold rather than to silent denial. An attached browser or CLI session
means someone can decide, so a channel turn running alongside one holds
as usual; and an agent whose rules allow everything never reaches this
path, because nothing it requests is unmatched.

**Egress Aliasing.** An Invocation target has no egress identity of its
own: before any decision, the gate resolves the calling agent to its
driver — recursively for chained Invocations, up to the root non-target
agent — and runs rule match, hold, and approval against the driver. The
link is live: rules are matched per request, so tightening or loosening
the driver applies to its running targets immediately. Approval prompts
raised by target traffic surface as the driver's, stamped with the
originating target, and approving permanently updates the driver's
rules. The aliasing is application-layer only — the target's gateway
still mounts and injects credentials for the target's own (attenuated)
connection grants, so the target gains the driver's network *reach*,
never its credential set. Deleting a driver cascades: its running
Invocations are failed and their targets eagerly reaped (transitively
for chains), and a target that slips past the cascade fails closed at
the gate because its driver no longer resolves.

## Channel turns

Binding a conversation surface — a Slack channel/DM or a Telegram
chat — lends the Agent, credentials included, to everyone the
messenger admits there ([channels](channels.md)). Every channel turn
relays to the main agent pod and runs under the Agent's own
credential set, gated by the owner's egress rules exactly like any
other turn; no per-speaker credential selection happens. Such a turn can also place a file in the
Agent's workspace: an attachment sent in the conversation is written
there for the agent to open, so a speaker with no platform
identity is a writer to persistent state ([persistence](persistence.md)).
What such a turn cannot do is raise a *hold* — the decision has nowhere
to be made from a messenger, so an unmatched request is refused rather
than waited on (above). The binding owner's Terms-of-Use acceptance gates each turn
— the terms bind the party whose credentials run it — and the
security log attributes the allow to the messenger-native sender id
with basis *place*.

## `dam-run`

The in-pod `dam-run` CLI is a compatibility shim that runs its command
as a regular local process in the same pod (see
[agent-lifecycle](agent-lifecycle.md#dam-run--local-exec-shim)). It adds
no privilege: the command runs inside the agent's existing sandbox, with
the agent's existing egress boundary. The earlier remote-executor
machinery (ephemeral `Run` pods borrowing the parent's gateway) was
removed.

## Intra-cluster identity and admission

The agent and the gateway are gated by different mechanisms — they live
on opposite sides of the credential boundary, so the threat models
differ:

- **`platform-migration` ServiceAccount** in the agent namespace — the
  identity of the one-time storage-migration copy Job, and the only
  workload on the platform that runs as **uid 0**. The Job needs root
  solely for the target side of the copy (owning a freshly provisioned
  volume root, restoring exact file ownership); every read of the agent's
  data drops to the agent's own uid, so a root-squashing source share
  never sees uid 0. The SA carries no role bindings and its token is
  never mounted (`automountServiceAccountToken: false` on both the SA and
  the pod), so it cannot act against the API; its sole purpose is to
  scope the OpenShift SCC grant that permits uid 0 to exactly this
  workload — an ops-side, out-of-band binding. The pod joins no mesh and
  mounts no credentials.
- **Per-Agent ServiceAccount** in the agent namespace, name ==
  Agent ID. Both pods of the long-lived pair run as this SA, but
  only the *gateway* pod is a mesh participant — istiod stamps it with
  a SPIFFE workload cert. The agent pod opts out of ambient
  (`istio.io/dataplane-mode: none`) and carries no SPIFFE identity.
  `automountServiceAccountToken`
  stays false on both pods; the gateway's SPIFFE cert is independent
  of SA-token mounts.
- **Agent → paired gateway** is gated at the kernel by the per-pair
  `<id>-agent-egress` NetworkPolicy. One egress rule: the paired
  gateway pod (`pair=<id>, role=gateway`) on the Envoy proxy port.
  DNS is not admitted — the agent addresses its gateway by ClusterIP,
  and name resolution for external hosts happens in the gateway, so
  anything in the pod that tries to resolve names directly fails
  closed. HBONE
  15008 is not admitted; the agent has no ztunnel and never speaks
  HBONE. Pair pinning is structural — the policy's pod-selector is
  the gateway pod itself, so a compromised agent has no admitted
  IP-and-port combination to reach anything else in the cluster.
- **api-server / controller → agent** is gated at the kernel by the
  chart-rendered `agent-ingress-platform-only` NetworkPolicy. The agent
  port admits ingress only from api-server pods (ACP/tRPC relay — the
  api-server has verified the user JWT and agent ownership before
  forwarding) and controller pods (idle-checker busy-probe). Everything
  else, gateway pods included, is dropped; the policy selects
  `role=agent`, so ephemeral executor pods are covered too.
- **Gateway → api-server harness.** All agent egress (including the
  harness call) flows through the paired gateway pod's Envoy, so what
  reaches the mesh is gateway → harness. The harness Service is
  `<rel>-apiserver-harness`, carrying `istio.io/use-waypoint`; Istio
  synthesises a waypoint Gateway pod in front of it. A per-Agent
  AuthorizationPolicy on the waypoint ALLOWs the gateway's SA
  principal to `/api/agents/<id>/*`; handlers can treat URL `:id`
  as authenticated.
- **Gateway → api-server ext-authz** routes through a per-Agent
  Service `<rel>-extauthz-<id>` rendered by the controller alongside
  each Agent. The AuthorizationPolicy on each Service ALLOWs only
  the matching SA principal. The destination Service is
  cryptographically pinned to
  the calling Agent; the api-server derives Agent ID from the
  gRPC `:authority`.
- **Pod-level DENY AuthorizationPolicy** on the api-server pod rejects
  anything that isn't either the waypoint's SA (harness) or a
  per-Agent SA from the agent namespace (ext-authz), closing the
  direct pod-IP bypass.

NetworkPolicy is the security boundary for the agent's egress; mesh
AuthorizationPolicy is the security boundary for the gateway's egress
to api-server endpoints. Each pod's gate matches its threat model:
the agent runs untrusted code and is held at the kernel layer; the
gateway is platform-controlled and its identity flows through the
mesh.

## Dev cluster: SVID rotation resilience

A dev-cluster constraint, not an architectural property. A lima VM that
sleeps with the host can slip past the mesh's default certificate rotation
window, expiring workload SVIDs (and cert-manager's webhook cert) and stalling
every mesh hop — an expired waypoint cert stalls only the flows through that
waypoint, so it can masquerade as an app-level bug. The local
`cluster:install` lengthens the workload cert TTL and installs a watchdog that
rolls affected mesh workloads; `cluster:status` reports the signature and
`cluster:fix-certs` heals on demand. Symptoms and recovery live in the
[`cluster-ops`](../../.claude/skills/cluster-ops/SKILL.md) skill. Production
deployments configure mesh PKI separately and get none of these knobs.
