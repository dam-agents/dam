# Credential gateway

Last verified: 2026-10-05

## Overview

The credential gateway is the Envoy proxy in each Agent's paired gateway
pod: every HTTPS request the agent makes exits through it, and for the
hosts the agent's Connections cover it adds the real credential on the
wire, from Secrets mounted on the gateway pod only. This page owns the
mechanics of that path — how a host gets an intercepting chain, how
credentials are injected, and what keeps the gateway bootable when a
Secret goes bad. The trust model it enforces — who holds credentials, the
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
reads the address — the path prefix, or the token placeholder in a
claimed header or query parameter — and marks the request with its
Connection. An injector skips when the marker names a rival on its
header over an overlapping scope; on an Agent requiring addresses,
unless it names its own Connection, so the request keeps its
credential. The prefix and marker are dropped on the way upstream. A
request naming no Connection on a
contested scope is refused by that same step, not served from whichever
credential sorted first. The gate reads the path with the prefix
removed, so egress rules and approvals keep naming real paths.
