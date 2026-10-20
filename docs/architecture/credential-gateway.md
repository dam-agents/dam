# Credential gateway

Last verified: 2026-10-20

## Overview

The credential gateway is the Envoy proxy in each Agent's paired gateway pod, or, for vm Agents on an install that turns it on, in the owner's one gateway pod ([owner gateway](#owner-gateway)): every HTTPS request the agent makes exits through it, and for the hosts the agent's Connections cover it adds the real credential on the wire — injected into a header or query parameter, or, for S3-compatible storage, by signing the request with keys the agent never holds — from Secrets mounted on the gateway pod only.
This page owns the mechanics of that path — how a host gets an intercepting chain, how credentials are injected, how requests are signed, and what keeps the gateway bootable when a Secret goes bad.
The trust model it enforces — who holds credentials, the pod and mesh boundaries, and the ext_authz HITL gate every forwarded request passes — lives on [security-and-credentials](security-and-credentials.md).
Model calls reach it through the agent-side [Model Router](harness-config.md#the-model-router), which sends each call with the target Connection's placeholder in the header the Connection claims here and holds no credential.

## Envoy credential injection

The controller renders a per-Agent `Envoy bootstrap ConfigMap` and a cert-manager `Certificate` whose Secret holds the leaf TLS material the gateway uses to terminate agent egress TLS.
The leaf is issued by a chart-managed MITM CA whose certificate is mounted into the agent — public half only, the key never leaves the gateway pod — so the agent's TLS clients trust Envoy's intercept cert.

On the wire:

1. Agent sets `HTTPS_PROXY=http://<agent>-gateway:<envoyPort>`; the per-Agent gateway Service routes to the paired gateway pod.
   TLS egress arrives as HTTP CONNECT, plain HTTP in absolute form, forwarded without interception.
   With a telemetry backend, plain HTTP to the gateway's own address on a reserved OTLP path goes to the collector instead, with no egress check, since it reaches nothing else (see [observability](observability.md#agent-export)).
2. Envoy's outer listener (reach gated by NetworkPolicy) stamps the trusted attribution header on every request it forwards, or strips it where no telemetry backend is configured; either way the agent cannot supply its own (see [observability](observability.md)).
   CONNECT it terminates, routing the inner stream into an internal listener that reads SNI.
3. Per-host filter chains terminate TLS with the leaf cert, run the credential injector(s) to add the configured header(s) (or rewrite `?<param>=<value>` into the URL — see below), then forward to a per-chain cluster pinned to the host (explicit upstream SNI, SAN-bound TLS validation).
   The agent's inner `Host` header has no influence on the upstream destination — the route-confusion exfiltration path is structurally closed.
   Allow-only chains (path-rule promoted, no credential) keep using the dynamic forward proxy — they have no credential to misroute.
4. The default chain (SNI miss) does TCP passthrough — the request reaches the upstream unchanged.

Whatever chain forwards it, the gateway pod's own egress NetworkPolicy bounds where the dial may land — public addresses plus the platform pods and private ranges it names — so no approved name can resolve into the cluster or the metadata endpoint ([security-and-credentials](security-and-credentials.md#hitl-ext_authz)).

**L7 promotion.** An egress rule that narrows a host by path, method, or port is invisible to the L4 catch-all (it sees only SNI), so the rule's host must be *promoted* onto a TLS-terminating chain to be enforceable over HTTPS.
The promotion signal is the Agent resource's `l7Hosts` spec list — per-agent intent, exactly like connection grants: promoting a host on one agent rolls only that agent's gateway, never a sibling's.
Promoted hosts get an uncredentialed L7 chain (gate sees method/path; nothing is injected) and extend the leaf certificate's SAN list.

`l7Hosts` is a pure projection of the agent's active rules: the api-server recomputes it from the rule set after every create, edit, and revoke and writes it wholesale, so a host is demoted (dropped from interception) as soon as its last narrowing rule is gone.
A roll follows any change to that set and nothing else, so the projection ships in the contract package: clients predict an interruption with the server's own rule, not the rule's shape.
Connection-derived rules are excluded — their host is already TLS-terminated by the connection's own credential chain.
Because each entry is interpolated into the gateway's Envoy bootstrap and cert SANs, the CRD constrains list items to DNS hostnames, so a rule host cannot inject config into the owner's gateway.
That projection is a second write to the Agent CR that cannot share a transaction with the rule write, so a per-agent periodic reconcile re-derives it from the rules — converging a host whose patch failed, or whose api-server died between the rule commit and the patch, without operator action.

A chain whose host is the telemetry collector's is dropped, logged as a warning — the collector's own stamping chain claims that server name, and two claiming one is a fatal Envoy config.
That host keeps neither credential injection nor L7 gating (see [observability](observability.md)).

A referenced SDS file missing from the mounted Secret is a fatal Envoy boot error, so the controller verifies each credential's SDS key against the Secret's data at render time and degrades that host to an allow-only chain (logged as a warning) rather than emit an unbootable bootstrap.
Requests to the host then go out uncredentialed — failing upstream auth for that host only — instead of crash-looping the whole gateway.
Stale Secrets written by since-replaced code paths are the known trigger.
The same render-time check covers the two connection inputs Envoy itself validates.
A host that is not a DNS name or a leading `*.` wildcard (a bare `*`, a partial wildcard, a space) gets no chain at all, since Envoy rejects it as a server name.
A header name that is not an RFC 7230 token degrades its host to allow-only.
Both are logged as warnings.
The Connections API refuses these inputs, and a value format without `{value}`, at create time; the render-time check covers Secrets that got past it.

That check covers a credential already known to be bad when the gateway is rendered.
A credential can also be revoked *after* it — disconnecting a connection deletes its Secret, and a gateway roll already in flight can carry the reference past the deletion.
A Secret mount is mandatory, so that pod never starts, and Kubernetes will not replace a pod that is not ready with the corrected configuration that follows seconds later: the gateway would keep its Service and lose all egress until an operator deleted the pod.
The controller therefore evicts gateway pods left running a configuration it has already superseded, whatever wedged them, and names that state on the gateway's readiness condition so it reads as a failure being repaired rather than a slow start.
Recovery costs a normal gateway restart.
The race itself is not closed — deletion is not atomic with the roll — so the eviction, not the ordering, is what bounds the harm.

A gateway that fails anyway — crash-looping, or wedged on a superseded configuration — leaves the agent pod ready, so the agent still reads as running and chat works while its egress is down.
The agent view therefore carries the gateway's failure message apart from the agent's state, and the UI shows it as a warning next to that state.
Only hard failures count: a gateway that is starting, rolling, hibernated or parked over budget shows no warning.

**Rotation.** A credential rewritten in place — a rotation, or a refreshed OAuth token — needs no roll: Envoy watches the mounted SDS and credentials files and swaps the new value in.
The kubelet, though, rewrites a mounted Secret only when it syncs the pod, which on its own happens about once a minute.
So the controller watches the credential Secrets the api-server writes, keeping their metadata only, and on a change reconciles that owner's Agents.
The reconcile stamps the gateway pod with an annotation derived from the resource versions of the credential Secrets it mounts; a changed annotation makes the kubelet sync the pod at once.
That sync can come before the kubelet's own copy of the Secret has the new version, so the reconcile comes back about five seconds later and stamps a second annotation with the same revision, which syncs the pod once more.
The new value is therefore in use within about ten seconds.
The annotations carry no credential, the pod's spec and its StatefulSet's template stay unchanged so nothing restarts, and the gateway gains no access to the API.
If both stamps fail, the periodic sync still delivers the value within about a minute and a half, the upper bound of the pickup time.

A host's L7 chain can opt into HTTP/2 so credential injection also covers gRPC request streams (e.g. Modal); hosts default to HTTP/1.1 unchanged.

**Non-443 upstreams and streaming.** Per-host injection descriptors can carry three more chain-level attributes, for upstreams such as external Kubernetes clusters:

- **Upstream port** — the pinned cluster dials the declared port (default 443).
  Only L7 chains honor ports: the SNI-miss L4 catch-all always dials 443, since SNI carries no port, and allow-only chains forward via the dynamic forward proxy, which honors the inner request's own `Host:port`.
- **Upgrade tunneling** — chains that opt in tunnel HTTP Upgrade flows (WebSocket, and SPDY/3.1 for older Kubernetes clients), so `kubectl exec` / `port-forward` / `logs -f` work through the credential-injecting path.
  The credential rides the upgrade request and ext_authz gates it once; after the 101 the gateway splices bytes under a long tunnel idle timeout.
  Upgrade chains stay HTTP/1.1 — upgrades don't survive an HTTP/2 upstream leg.
- **Upstream trust** — chains validate the upstream against the system trust store, plus any CA the install names for a TLS-intercepting egress path (a corporate proxy, or the platform's own gateway when it runs in an agent).
  A connection carrying its upstream's own CA in its Secret (self-signed cluster CAs) is validated against that alone.
  SAN pinning is unchanged; the agent always trusts the platform MITM CA, never an upstream's.

**Path rewriting.** An injection descriptor can declare path prefix rewrites for its host: the chain matches those prefixes ahead of its catch-all route and swaps the prefix on the way upstream, after the ext_authz Check, so egress rules describe the paths the agent requests.
Both ends of a rewrite are whole path segments and the gateway drops any that are not, so a rewrite cannot reach past what the host's chain admits.
One prefix carries one replacement: conflicting Secrets keep the first and log the loser.

**Multiple injection steps per host.** A single host can carry more than one credential — either two different credentials (e.g. an API key and a tenant ID on distinct headers) or the same credential injected into both a header and a URL query parameter, for upstreams that authenticate off the URL.
The controller groups Secrets by host into one L7 chain with an ordered list of credential injectors; a step that targets a query parameter has its value moved into the URL instead, percent-encoded, and the carrier header never reaches the upstream.

**Two connections claiming one header.** Where two Connections inject one header on one host over paths that overlap, the header alone no longer says which account to act as.
Chains are cut by path scope as well as host: a route per scope carries only the injectors whose own scope covers it.
Where a scope is claimed twice, the [per-Connection address](connections.md#addressing-a-connection) picks one, by either carrier.
A Lua step ahead of every other filter on a Connection chain reads the address — the path prefix, the token placeholder in a claimed header or query parameter, or the access key ID of a SigV4 credential (below) — and marks the request with its Connection.
An injector skips when the marker names a rival on its header over an overlapping scope; on an Agent requiring addresses, unless it names its own Connection, so the request keeps its credential.
The prefix and marker are dropped on the way upstream.
A request naming no Connection on a contested scope is refused by that same step, not served from whichever credential sorted first.
The gate reads the path with the prefix removed, so egress rules and approvals keep naming real paths.

**Model-provider chains.** A chain whose credential comes from a model-provider Connection also carries the spend meter, directly after the address step and before the gate.
On such a chain the gateway gives each call an id the agent cannot set, removes the request's compression offer so that the reply stays readable, reads the usage in the reply without changing it, records the session and harness that the Model Router stamped, and sends a spend record per call to the api-server.
On every chain, the gateway removes that stamp before the request leaves.
The depth is on [spend-limits](spend-limits.md).

## Request signing

S3-compatible storage (IBM Cloud Object Storage, AWS S3, MinIO, Ceph) authenticates with SigV4: the client signs each request with its secret key, and the key itself never travels.
There is no header value the gateway could swap in, so for a Connection holding an HMAC key pair the gateway **re-signs the request** instead of injecting into it.
The agent holds a placeholder key pair — the Connection's token placeholder as the access key ID, a dummy secret ([connections](connections.md#addressing-a-connection)) — and the real pair exists only in the per-Connection Secret, mounted on the gateway pod as a credentials file.
On the wire, a request that names the Connection leaves with the real key ID, a fresh signature and an unsigned payload; a request on the same host naming any other key passes byte-for-byte untouched.

On the host's L7 chain a **signing step** sits after the injectors and before the forwarding filters, one per Connection with keys for that host.
It reads the pair from the mounted file only — no fallback to the environment, instance metadata or container credentials — and signs the request as the upstream will see it: the authority is the upstream host itself (with its port when not 443), the address marker is left out of the signed headers, and the payload is declared unsigned, so the signature covers the request line and headers and the body passes through unread.
Signing the upstream authority inside the step is what makes path-prefix addressing unsupported for these Connections — the prefix is stripped after the signature is computed, so the token placeholder is their only address.

Both the step and its guard (below) run only for a request naming the Connection — the address step reads the access key ID out of a SigV4 `Authorization` header as it reads a placeholder out of any other claimed header — and that gate holds whatever the Agent's require-addresses setting says.
Everything else on the host passes as it came: a request carrying a foreign key, an unsigned one, and the platform's own presigned artifact links, which can share an endpoint with a user's bucket.
Signers never contest a host: two storage Connections on one endpoint, or a signer beside a header injector, cut no refusal route and disable nothing, since each signs only the requests that name it.

Signing is bounded by the Connection's bucket.
The egress rules are the Agent's, not the Connection's: a storage Connection limited to one bucket beside another on the same endpoint with none would see a request naming it on a sibling bucket admitted by the wider Connection's rules.
So a **guard** ahead of each signing step carries its own Connection's path scopes — the same `/<bucket>`, `/<bucket>?…` and `/<bucket>/…` patterns its egress rules use — and refuses a request naming the Connection on any other path with a readable 403 that says the egress gateway, not the storage service, refused it, which paths the Connection is limited to, and that the request was not signed.
It matches the path as sent, the way the egress rule does — no decoding, no dot-segment folding, the bucket as the whole first segment, so `/<bucket>x` is outside — after stripping a path-prefix address as the rule check does.
A Connection without a bucket keeps signing the whole host, and the key's upstream role is the limit there.

The signed body has to be plain.
A client that streams an upload as `aws-chunked` — a `STREAMING-` content hash, signed or unsigned, with a trailing checksum — has produced a body the gateway cannot re-sign, so the same guard refuses such a request with a readable 400 saying the egress gateway, not the storage service, refused it, that it re-signs requests and cannot re-sign a streaming upload, and which client setting turns streaming off.
The profiles the platform writes already carry that setting ([connections](connections.md#app-preset-s3-compatible-storage)), so the refusal reaches only a client that overrode them, as its own message rather than a signature mismatch from upstream.

Rotation needs no roll: the signing step watches the mounted credentials file, and a key pair rewritten in place by the Connections context — after it has re-proven the new keys against the endpoint — is in use within seconds, as any credential rewritten in place is (**Rotation**, above), with the agent's placeholders untouched.
Adding or removing the credentials file is a configuration change and rolls the gateway, as an SDS key appearing or vanishing does.
A credentials file the descriptor names but the Secret lacks, or a signing entry without its region or service, degrades the host to allow-only with a warning rather than rendering an unbootable gateway — the same answer a missing SDS file gets.

## Owner gateway

With `virtualization.gateway.perOwner` on, one gateway pod per owner serves every vm Agent of that owner in place of a gateway pod each.
It is off by default, and container Agents always keep their own gateway, so everything above holds for both kinds; this section says what differs.
The trust model it rests on lives on [security-and-credentials](security-and-credentials.md#owner-gateway-identity).

**Identity is the agent's own Service.** Each vm Agent keeps its own gateway Service and ClusterIP, which its machine's allowlist and resolver name, so moving an agent changes no machine spec.
The controller gives each agent a slot on the owner gateway, a proxy port and a resolver port recorded on that Service, and the Service maps every port it declares onto that slot alone.
A ClusterIP carries nothing on a port it does not declare (measured on OVN-Kubernetes and k3s), so a guest pinned to its own address reaches only its own listener.

**One Envoy, one listener per agent.** The owner gateway's bootstrap holds only what its agents share: the harness, object store, dynamic forward proxy and collector clusters.
Each agent's listener, internal listener and clusters, every name suffixed with the agent, are files Envoy watches beside it, along with the Lua bodies the chains read and the leaf's file source.
Each listener carries exactly that agent's chains, credentials, egress checks, spend meter, attribution and ext_authz destination, rendered as above.
A change to one agent replaces only its own listener, which drains only its own connections; a file that does not load leaves the last good one serving.
The whole set, its credentials and its leaf file source live in one Secret of 1 MiB; an owner past it is refused with that reason, and its agents go back to their own gateways as they do with the flag off.

**Harness guard.** The mesh sees one principal for all of the owner's agents, so it cannot keep one agent off a sibling's harness paths.
Each agent's listener sends the harness authority, by CONNECT or plain HTTP, into a guard that admits only that agent's own path prefix, normalizing the path and refusing escaped slashes first, and refuses anything else with a 403.
What it admits leaves stamped with the agent's name in a header that every other route of the owner gateway strips, and the agent's harness policy admits the owner principal only with that header naming the agent.
A request that reaches the harness address by another spelling, outside the guard, therefore carries no name and is refused at the waypoint.

**Credentials and leaf.** The controller copies the keys the gateway reads, from every Secret granted to any of the owner's vm Agents, into one per-owner Secret, each key prefixed with its Secret's name; a Secret not granted, or another owner's, never enters it.
The controller writes it only when its content changes, so a grant, a revocation or a rotation reaches the mounted files without a restart.
Its pod is stamped twice per content hash of the credentials in that Secret — a change to its files alone does not stamp it, since Envoy reads those as the volume updates — as an agent's own gateway pod is per revision (**Rotation**, above), so a rotation is in use as soon.
One leaf names every host any of the agents intercepts, from the same issuer, so a machine's CA is unchanged.
The resolver is one CoreDNS with one block per agent's resolver port, each answering with that agent's ClusterIP and reading its file again on change.
It reads one file of that Secret and is handed a volume of its own that projects that key alone, so a process in the resolver container can no more read a signing key than one outside the pod can.

**Readiness.** An agent's listener answers the gateway health path with a revision of what was rendered for it.
An agent moves onto the owner gateway only once the owner pod answers its revision; after the move its gateway readiness is that probe through its own Service, a stale listener reads as starting, and a failing owner pod gives every agent it serves that pod's failure.
Once moved, the agent's own gateway pod and the objects around it are removed.
Turning the flag off, or a refused owner, renders them again, and each agent moves back once its own gateway pod is ready.
Until then its policies still admit the owner gateway and the owner gateway still renders it, so its grants stay current; the owner gateway goes once no agent is left on it.
The controller renders the owner gateway after the runner call, so a machine's start never waits for it.

**One volume for the files and the credentials.** An owner gateway's files are in-place updates to a running pod, and a listener names the credential file its chain signs with, so the two must reach the pod together.
With one object per kind they do not: the kubelet projects a ConfigMap and a Secret on separate flips, and Envoy can read a listener that names a credential while the other volume still lacks it.
A credentials provider built then fails its first read, installs no watch, and never reads that file again, and Envoy accepts the listener regardless — so the health path answers the current revision while every request stays unsigned.
The gateway's bootstrap, listener, cluster and leaf-SDS files, its Lua bodies, its resolver Corefile, its credentials and its upstream CAs are therefore one Secret mounted as one volume.
The kubelet flips a projected volume once, all keys together, so a file that names a credential and the credential itself become visible at the same moment and no provider is built in between.
The leaf TLS files stay a Secret of their own: cert-manager writes them, a rotation changes their content rather than their names, and the leaf-SDS file that names them never moves.
One case the one volume does not close: a key the pod has never had.
The kubelet moves the volume's data into place before it publishes the new key at the path a listener names, so a listener that arrives in that same flip can still name a file whose pathname appears a moment later, and the provider built then never reads it.
The controller therefore keeps one piece of state per owner — the credential-file set of the Secret it last *applied* — and decides a repair from nothing else.
It is written on that Secret's annotation and holds four things: the published key set, the count of generations handed out, the generation each published key is repaired at, and the generation each member's internal listener was written with.
Publication is only what was applied: the set is read from the Secret's own data after a successful write, so a render the owner discards, a wider render it refuses, and a write that failed all leave it as it was, and a credential from a render that never reached the pod is never recorded as published.
A revocation replaces the set wholesale, so a key that leaves the render leaves the set and its generation with it, and its return is published unobserved again.
A key takes a generation the first time a render finds it *already published*, which is by construction one render after the one that wrote it: the kubelet publishes a key's pathname in the same volume flip that starts the provider, so the render that first writes a key must not be the render that repairs it.
That generation reaches only the agents whose own chains name the key, and only once the agent answered the rendering carrying it, since a flip is asynchronous and writing a publication proves nothing about what the pod read.
It moves `filter_metadata` on that agent's internal listener — where its providers are built — and by then the pathname is on disk, so those providers are built again and read a file that exists.
A rotation of a file the pod already has is not an arrival and costs no generation, and a revoked key is not one either: it takes its chain with it.
The generation is left out of the listener's health revision, so an agent's outer listener does not change and no connection is drained for a repair that is not about it; it is also left out of what an offer considers the rendering a pod answered, because a repair that changed its own evidence would re-arm the offer forever.
An agent whose chains name none of the arriving keys is owed nothing and stays byte-identical.
A render the owner refuses is never planned, so a refused owner gains no generations at all.
A controller that restarts rebuilds the published set from the Secret's own data — not from the note beside it, so a Secret written before that note existed still gives the baseline, and the keys it holds are treated as generation zero — and resumes the counters from that note, where an absent note means generation zero, which can under-count a repair but never invent one.
A read that failed is retried rather than accepted as an empty baseline, which would make every published key look new.
The note is written from the applied render only, pruned to the keys that still publish and the members still served, so it stays the size of the live state however many keys an owner retires.
An install that upgrades keeps the previous layout's ConfigMap and credentials Secret while a Deployment or a pod still mounts them, written with each render, and removes them once none does.
Those objects name the credential root that layout mounts (`/etc/envoy/credentials`), not the one-volume root, so a pod of that layout kept serving through a blocked roll reads files under paths it has.
A delete that failed is not reported as done: the objects are removed by a later render instead.

**A listener the pod refused.** The files still land in the pod after the controller writes them — usually in a second, but the kubelet's documented fallback for a changed Secret is its sync period plus its cache delay, up to about a minute and a half — and Envoy applies the resources of one read one at a time.
So it can accept an agent's outer listener, whose clusters it already has, and refuse its internal one, whose upstream cluster is still in the CDS file it has not read; the outer listener answers the current revision meanwhile, so nothing the controller reads says the chains are missing.
Unchanged files cannot repair that: the controller writes nothing for a render that changes nothing, so the pod is never handed them again.
The controller therefore decides what to write from an answer it recorded, never from the absence of a bad one.
A pod that answers the revision rendered for an agent has read the files, so the owner writes them once more, with a version of their own in place of the template's: the pod reads them again and everything it refused is offered again with what it names already on disk.
A pod that answers anything else — an older revision, or nothing, as a sleeping agent and a freshly started controller answer nothing — has not read them, so the owner writes them again on a wait that doubles from four seconds, six times, the last about two minutes after the first, past the kubelet's documented sync period and cache delay; past it the pod keeps the listener it has and a warning names the agent.
An offer changes files, not resources: every listener and cluster in them is byte-identical, so Envoy deduplicates what it accepted and no stream is drained for a repair.
One write carries every agent that is owed one, and no two offers land closer than two seconds, so an owner with many agents is not written once per agent; a grant or a revocation is written as soon as it is rendered, unthrottled.
Readiness tells the two apart only partly: a listener Envoy accepted answers the current revision whether or not the provider it built was ever able to read its file, and so does an outer listener whose internal resources were refused, while a container-level rejection or a listener never loaded reads as stale.
Signing that stays broken after the bounded offers is therefore a healthy-looking gateway, and it may produce no warning at all: the give-up warning covers an agent whose listener never came current, which this one is not.
What an operator has is the agent's unsigned requests and the failed read in the gateway's own log.

**Rolls.** The owner gateway is a one-replica Deployment that surges a new pod before the old one stops.
The new pod turns ready on a health listener that Envoy opens only once its first load of the agents' files is done.
The old pod sleeps out most of its grace before Envoy is signalled, serving the streams it holds while the new one takes new connections.
A template change that moves it onto the one files Secret is rendered, not applied on its own: the Secret is written first and an owner whose files are past the limit is refused, so its agents keep the pod that serves them while they move back.
The sweep that offers every existing owner its turn waits for the agent cache to sync: a cache that has not listed yet is not an owner with no agents, and rendering on that answer would write an empty set of listeners for a gateway whose Services still select it.
Only a template change (an image, the install's trust settings) rolls it, paced across owners by the same roll width as runner rolls (`rollout.maxConcurrent` runners, or `rollout.maxConcurrentPercent` of them); listener, credential and leaf changes never do.
A gateway already mid-roll holds one of the width's places, so a later template change replaces its stuck target in the place it holds rather than taking another: a fleet that shrinks under a stalled roll — owners removed, the share falling below the gateways stuck on it — still takes a corrective change, where counting its peers alone would leave every one of them blocked.
