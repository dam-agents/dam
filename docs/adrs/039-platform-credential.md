# ADR-039: Per-instance platform credential injected by the gateway pod

**Date:** 2026-05-06
**Status:** Accepted
**Owner:** @pilartomas

## Context

Until now, agent pods reach the api-server's harness port (MCP, file-push
SSE, `/internal/trigger`) without proving identity. The only check on the
platform side is "this request comes from a pod whose IP an
[admitted resolver](../../packages/api-server/src/modules/instances/infrastructure/pod-ip-resolver.ts)
maps to an `agent-platform.ai/instance` label." Earlier work — when the
agent process and a credential-handling sidecar shared a network namespace
([ADR-033](033-envoy-credential-gateway.md)) — could not safely give the
agent a Bearer token: the agent process is third-party harness code
(Claude Code, Codex, Gemini CLI) and any token on disk or in env was
immediately readable by the harness.

[ADR-038](038-paired-gateway-pod.md) split each instance into two paired
pods — `agent` and `gateway` — and made the gateway the only path to TCP
80/443. The gateway pod is platform-controlled and structurally isolated
from the harness process: a credential mounted in the gateway pod is
never reachable by the agent pod's filesystem or `/proc/<pid>/environ`.
That removes the constraint behind the missing identity check.

There is also visible breakage today.
[`pod-files-events.ts`](../../packages/api-server/src/apps/harness-api-server/pod-files-events.ts)
still requires `Authorization: Bearer <token>` and validates against an
`accessTokenHash` field on the **agent** ConfigMap — a field
[`status.go`](../../packages/controller/pkg/reconciler/status.go) declares
but the controller never writes — and the agent-runtime's
[`sse-client.ts`](../../packages/agent-runtime/src/modules/pod-files/sse-client.ts)
sends no Authorization header at all. The channel never connects, the
loop reconnects with backoff, and managed files never reach running
agents.

## Decision

Each instance is provisioned a **per-instance platform credential** at
reconcile time. The paired gateway pod's Envoy attaches it on every
api-server-bound request as `Authorization: PlatformInstance <token>`;
the api-server validates the header against
`platformCredentialHash` stamped on the instance ConfigMap status.

Wire shape:

```
agent-runtime →[HTTP_PROXY]→ paired gateway pod (Envoy) →[+Authorization]→ api-server harness port
```

Components:

- **Controller** mints a 32-byte random token (base64url) on first
  reconcile, stores it in a per-pair Secret named `<pair>-platform-cred`
  with two keys:
  - `token` — raw value, read by the controller on subsequent reconciles
    so pod restarts re-stamp the same hash. Never mounted into the
    gateway pod.
  - `sds.yaml` — Envoy SDS DiscoveryResponse holding the literal header
    value `PlatformInstance <token>` (single mount, single key
    projection).

  The Secret is owner-referenced to the instance ConfigMap so K8s GC
  cleans it up on instance teardown. SHA256(token) is written to the
  instance ConfigMap status as `platformCredentialHash`.

- **Gateway pod's Envoy** gains `credential_injector` on the outer HCM,
  scoped via per-route config to a new platform-internal route. The route
  matches plain HTTP requests whose `:authority` equals the configured
  api-server harness `host:port`, disables ext_authz (control-plane
  traffic, not credentialed user egress), and forwards to a STRICT_DNS
  cluster pinned to the api-server Service. The agent's Host header
  cannot redirect a credentialed request elsewhere — destination is
  fixed in config.

- **Agent pod env** drops `apiServerHost` from `NO_PROXY`. Platform
  traffic now flows through `HTTP_PROXY = http://<pair>-gateway:<port>`,
  the same path harness external traffic already takes.

- **agent-runtime** drops the explicit `directAgent` HTTP agent in the
  pod-files SSE client and trigger watcher, and uses `fetch` so undici's
  `NODE_USE_ENV_PROXY=1` honoring carries platform calls through the
  paired gateway. The agent-runtime never sees the token.

- **Forks** reuse the parent instance's platform-credential Secret. The
  api-server's harness endpoints are URL-keyed on the parent instance
  (forks have no separate URL surface), so the fork's gateway
  authenticates as the parent. Per-fork **upstream** credential
  isolation ([ADR-027](027-slack-user-impersonation.md)) is unchanged —
  this credential is platform-internal identity, not the
  replier-vs-owner upstream-credential boundary.

- **API-server validation**:
  [`verifyInstanceCredential`](../../packages/api-server/src/apps/harness-api-server/instance-auth.ts)
  reads `platformCredentialHash` from the URL-named instance's status,
  hashes the inbound token with SHA256, and constant-time-compares.
  Mounted on `/api/instances/:id/mcp`, `/api/instances/:id/pod-files/events`,
  and `/internal/trigger`. Cross-instance reuse fails by construction:
  hashing instance-A's token against instance-B's status will never
  match.

The legacy `accessTokenHash` field on the agent ConfigMap is removed —
it was declared but never written, and the field was on the wrong
ConfigMap (per-agent rather than per-instance).

## Alternatives considered

**Token in agent-pod env var.** Rejected: the harness shares the agent
pod's PID namespace, so any process in the pod can `cat /proc/<pid>/environ`
on the agent-runtime and read the token. The whole point of ADR-038's
split is to put credentials in a different pod.

**HMAC the request on the agent side.** Rejected for the same reason —
an HMAC key in the agent pod is no more isolated than a Bearer token.

**mTLS between agent-runtime and api-server.** Rejected: requires a
per-instance certificate the agent pod must mount to authenticate, which
is the same isolation problem. Pinning the cert to the gateway pod
breaks the obvious property that the agent-runtime is the client.

**Index credentials by hash globally.** Rejected: makes
the api-server validate without a URL-instance cross-check, opening the
door to cross-instance impersonation if a token leaks via logs or a
mis-configured upstream. Per-instance hash, looked up via URL, is the
narrowest scope that still works.

**Defer fork credentials to a follow-up.** Rejected: forks call
`/api/instances/:id/mcp` against the parent instance the same way live
agents do. Leaving forks unauthenticated would put a backdoor in the
contract the api-server claims to enforce. Reusing the parent's Secret
keeps fork-side complexity zero without weakening the platform-internal
boundary.

## Consequences

- **Defense-in-depth restored.** A compromised pod that bypasses
  HTTP_PROXY (e.g. through CAP_NET_ADMIN inside the agent pod) still
  cannot reach the api-server harness as another instance — the only
  way to get a valid `Authorization` header is through the paired
  gateway, and each pair's gateway only holds its own Secret.

- **File-push channel works again.** The cred-stamp closes the
  half-finished migration: `pod-files-events.ts` validates against
  `platformCredentialHash` (which the controller now writes), and
  `sse-client.ts` runs through HTTP_PROXY so Envoy attaches the header.
  The reconnect-and-401 log spam is gone.

- **Bootstrap template revision bumped.** `envoyBootstrapTemplateRev` is
  `v4-platform-cred`; live gateway pods roll on chart upgrade so the new
  filter chain is loaded.

- **`PLATFORM_API_SERVER_HOST` env retired.** Its only consumer was the
  `NO_PROXY` carve-out for api-server traffic. Now that platform traffic
  is supposed to flow through the gateway, the carve-out would defeat
  credential injection.

- **No rotation in this iteration.** Instance lifetimes are short
  relative to any reasonable rotation cadence — see issue #108
  §Out-of-scope. The Secret-as-source-of-truth lets a follow-up rotate
  by deleting+recreating the Secret in place.

- **No cross-instance scoping beyond instance identity.** Per-user or
  per-session scoping is out of scope; instance identity is sufficient
  for the threats this ADR addresses (impersonation across siblings).

## Related ADRs

- [ADR-005](005-credential-gateway.md) — pattern: agent never sees
  upstream credentials. Extended by this ADR to platform-internal
  credentials.
- [ADR-022](022-harness-api-server.md) — the harness API server's
  restricted surface area, now credential-gated end-to-end.
- [ADR-033](033-envoy-credential-gateway.md) — Envoy filter chain shape.
  This ADR adds one filter (`credential_injector` on the outer HCM,
  scoped via per-route config) and one route (`platform_internal`).
- [ADR-035](035-unified-hitl-ux.md) — ext_authz gate on credentialed
  external traffic. Disabled on the platform-internal route by
  per-route config; control-plane traffic is not user-driven egress.
- [ADR-038](038-paired-gateway-pod.md) — pre-requisite. This ADR is
  only safe because the gateway pod is structurally isolated from the
  agent pod.
