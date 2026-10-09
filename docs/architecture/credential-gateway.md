# Credential gateway

Last verified: 2026-10-09

## Overview

The credential gateway is the Envoy proxy in each Agent's paired gateway
pod: every HTTPS request the agent makes exits through it, and for the
hosts the agent's Connections cover it adds the real credential on the
wire — injected into a header or query parameter, or, for S3-compatible
storage, by signing the request with keys the agent never holds — from
Secrets mounted on the gateway pod only. This page owns the mechanics of
that path — how a host gets an intercepting chain, how credentials are
injected, how requests are signed, and what keeps the gateway bootable
when a Secret goes bad. The trust model it enforces — who holds credentials, the
pod and mesh boundaries, and the ext_authz HITL gate every forwarded
request passes — lives on
[security-and-credentials](security-and-credentials.md).

## Envoy credential injection

The controller renders a per-Agent `Envoy bootstrap ConfigMap` and a
cert-manager `Certificate` whose Secret holds the leaf TLS material the
gateway uses to terminate agent egress TLS. The leaf is
issued by a chart-managed MITM CA whose certificate is mounted into the
agent — public half only, the key never leaves the gateway pod — so the
agent's TLS clients trust Envoy's intercept cert.

On the wire:

1. Agent sets `HTTPS_PROXY=http://<agent>-gateway:<envoyPort>`; the
   per-Agent gateway Service routes to the paired gateway pod. TLS
   egress arrives as HTTP CONNECT, plain HTTP in absolute form,
   forwarded without interception.
2. Envoy's outer listener (reach gated by NetworkPolicy) stamps the trusted attribution header on every
   request it forwards, or strips it where no telemetry backend is
   configured; either way the agent cannot supply its own (see
   [observability](observability.md)). CONNECT it terminates, routing
   the inner stream into an internal listener that reads SNI.
3. Per-host filter chains terminate TLS with the leaf cert, run the
   credential injector(s) to add the configured header(s) (or rewrite
   `?<param>=<value>` into the URL — see below), then forward to a
   per-chain cluster pinned to the host (explicit upstream
   SNI, SAN-bound TLS validation). The agent's inner `Host` header has
   no influence on the upstream destination — the route-confusion
   exfiltration path is structurally closed. Allow-only chains
   (path-rule promoted, no
   credential) keep using the dynamic forward proxy — they have no
   credential to misroute.
4. The default chain (SNI miss) does TCP passthrough — the request reaches
   the upstream unchanged.

Whatever chain forwards it, the gateway pod's own egress NetworkPolicy
bounds where the dial may land — public addresses plus the platform pods
and private ranges it names — so no approved name can resolve into the
cluster or the metadata endpoint ([security-and-credentials](security-and-credentials.md#hitl-ext_authz)).

**L7 promotion.** An egress rule that narrows a host by path, method, or
port is invisible to the L4 catch-all (it sees only SNI), so the rule's
host must be *promoted* onto a TLS-terminating chain to be enforceable
over HTTPS. The promotion signal is the Agent resource's `l7Hosts` spec
list — per-agent intent, exactly like connection grants: promoting a host
on one agent rolls only that agent's gateway, never a sibling's. Promoted hosts get an uncredentialed L7 chain (gate sees
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

A chain whose host is the telemetry collector's is dropped, logged as a
warning — the collector's own stamping chain claims that server name, and
two claiming one is a fatal Envoy config. That host keeps neither
credential injection nor L7 gating (see
[observability](observability.md)).

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

A gateway that fails anyway — crash-looping, or wedged on a superseded
configuration — leaves the agent pod ready, so the agent still reads as
running and chat works while its egress is down. The agent view therefore
carries the gateway's failure message apart from the agent's state, and
the UI shows it as a warning next to that state. Only hard failures count:
a gateway that is starting, rolling, hibernated or parked over budget
shows no warning.

A host's L7 chain can opt into HTTP/2 so credential injection also covers
gRPC request streams (e.g. Modal); hosts default to HTTP/1.1 unchanged.

**Non-443 upstreams and streaming.** Per-host injection descriptors can
carry three more chain-level attributes, for upstreams such as external
Kubernetes clusters:

- **Upstream port** — the pinned cluster dials the declared port (default
  443). Only L7 chains honor ports: the SNI-miss L4 catch-all always dials
  443, since SNI carries no port, and allow-only chains forward via the
  dynamic forward proxy, which honors the inner request's own `Host:port`.
- **Upgrade tunneling** — chains that opt in tunnel HTTP Upgrade flows
  (WebSocket, and SPDY/3.1 for older Kubernetes clients), so `kubectl exec`
  / `port-forward` / `logs -f` work through the credential-injecting path.
  The credential rides the upgrade request and ext_authz gates it once;
  after the 101 the gateway splices bytes under a long tunnel idle timeout.
  Upgrade chains stay HTTP/1.1 — upgrades don't survive an HTTP/2 upstream
  leg.
- **Upstream trust** — chains validate the upstream against the system
  trust store, plus any CA the install names for a TLS-intercepting egress
  path (a corporate proxy, or the platform's own gateway when it runs in
  an agent). A connection carrying its upstream's own CA in its Secret
  (self-signed cluster CAs) is validated against that alone. SAN pinning
  is unchanged; the agent always trusts the platform MITM CA, never an
  upstream's.

**Path rewriting.** An injection descriptor can declare path prefix
rewrites for its host: the chain matches those prefixes ahead of its
catch-all route and swaps the prefix on the way upstream, after the
ext_authz Check, so egress rules describe the paths the agent requests.
Both ends of a rewrite are whole path segments and the gateway drops any
that are not, so a rewrite cannot reach past what the host's chain
admits. One prefix carries one replacement: conflicting Secrets keep the
first and log the loser.

**Multiple injection steps per host.** A single host can carry more than
one credential — either two different credentials (e.g. an API key and a
tenant ID on distinct headers) or the same credential injected into both
a header and a URL query parameter, for upstreams that authenticate off
the URL. The controller groups Secrets by host into one L7
chain with an ordered list of credential injectors; a step that targets a
query parameter has its value moved into the URL instead, percent-encoded,
and the carrier header never reaches the upstream.

**Two connections claiming one header.** Where two Connections inject
one header on one host over paths that overlap, the header alone no
longer says which account to act as. Chains are cut by path scope as
well as host: a route per scope carries only the injectors whose own
scope covers it. Where a scope is claimed twice, the [per-Connection
address](connections.md#addressing-a-connection) picks one, by either
carrier. A Lua step ahead of every other filter on a Connection chain
reads the address — the path prefix, the token placeholder in a
claimed header or query parameter, or the access key ID of a SigV4
credential (below) — and marks the request with its Connection. An injector skips when the marker names a rival on its
header over an overlapping scope; on an Agent requiring addresses,
unless it names its own Connection, so the request keeps its
credential. The prefix and marker are dropped on the way upstream. A
request naming no Connection on a
contested scope is refused by that same step, not served from whichever
credential sorted first. The gate reads the path with the prefix
removed, so egress rules and approvals keep naming real paths.

## Request signing

S3-compatible storage (IBM Cloud Object Storage, AWS S3, MinIO, Ceph)
authenticates with SigV4: the client signs each request with its secret
key, and the key itself never travels. There is no header value the
gateway could swap in, so for a Connection holding an HMAC key pair the
gateway **re-signs the request** instead of injecting into it. The agent
holds a placeholder key pair — the Connection's token placeholder as the
access key ID, a dummy secret ([connections](connections.md#addressing-a-connection))
— and the real pair exists only in the per-Connection Secret, mounted on
the gateway pod as a credentials file. On the wire, a request that names
the Connection leaves with the real key ID, a fresh signature and an
unsigned payload; a request on the same host naming any other key passes
byte-for-byte untouched.

On the host's L7 chain a **signing step** sits after the injectors and
before the forwarding filters, one per Connection with keys for that
host. It reads the pair from the mounted file only — no fallback to the
environment, instance metadata or container credentials — and signs the
request as the upstream will see it: the authority is the upstream host
itself (with its port when not 443), the address marker is left out of
the signed headers, and the payload is declared unsigned, so the
signature covers the request line and headers and the body passes
through unread. Signing the upstream authority inside the step is what
makes path-prefix addressing unsupported for these Connections — the
prefix is stripped after the signature is computed, so the token
placeholder is their only address.

Both the step and its guard (below) run only for a request naming the
Connection — the address step reads the access key ID out of a SigV4
`Authorization` header as it reads a placeholder out of any other claimed
header — and that gate holds whatever the Agent's require-addresses
setting says. Everything else on the host passes as it came: a request
carrying a foreign key, an unsigned one, and the platform's own presigned
artifact links, which can share an endpoint with a user's bucket. Signers
never contest a host: two storage Connections on one endpoint, or a
signer beside a header injector, cut no refusal route and disable
nothing, since each signs only the requests that name it.

Signing is bounded by the Connection's bucket. The egress rules are the
Agent's, not the Connection's: a storage Connection limited to one bucket
beside another on the same endpoint with none would see a request naming
it on a sibling bucket admitted by the wider Connection's rules. So a
**guard** ahead of each signing step carries its own Connection's path
scopes — the same `/<bucket>`, `/<bucket>?…` and `/<bucket>/…` patterns
its egress rules use — and refuses a request naming the Connection on any
other path with a readable 403 that says the egress gateway, not the
storage service, refused it, which paths the Connection is limited to,
and that the request was not signed. It matches the path as sent, the
way the egress rule does — no decoding, no dot-segment folding, the
bucket as the whole first segment, so `/<bucket>x` is outside — after
stripping a path-prefix address as the rule check does. A Connection
without a bucket keeps signing the whole host, and the key's upstream
role is the limit there.

The signed body has to be plain. A client that streams an upload as
`aws-chunked` — a `STREAMING-` content hash, signed or unsigned, with a
trailing checksum — has produced a body the gateway cannot re-sign, so
the same guard refuses such a request with a readable 400 saying the
egress gateway, not the storage service, refused it, that it re-signs
requests and cannot re-sign a streaming upload, and which client setting
turns streaming off. The
profiles the platform writes already carry that setting
([connections](connections.md#app-preset-s3-compatible-storage)), so the
refusal reaches only a client that overrode them, as its own message
rather than a signature mismatch from upstream.

Rotation needs no roll: the signing step watches the mounted credentials
file, and a key pair rewritten in place by the Connections context — after
it has re-proven the new keys against the endpoint — is in use within
about a minute, the kubelet's Secret refresh, with the agent's
placeholders untouched. Adding or removing the credentials file is a
configuration change and rolls the gateway, as an SDS key appearing or
vanishing does. A credentials file the descriptor names but the Secret
lacks, or a signing entry without its region or service, degrades the host
to allow-only with a warning rather than rendering an unbootable
gateway — the same answer a missing SDS file gets.
