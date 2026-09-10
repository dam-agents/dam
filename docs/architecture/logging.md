# Logging

Last verified: 2026-08-14

## Overview

The api-server logs through a single process-wide **Pino** logger ([`packages/api-server/src/core/logger.ts`](../../packages/api-server/src/core/logger.ts)), configured once at startup from the `info`-default log level. Output is one JSON object per line on stdout; the common levels `error/warn/info/debug` are the only knob — there is no per-feature toggle. Visibility is the operator's level choice, governed the usual way. Every line also carries the server's `appVersion` as a base field, stamped once at logger configuration, so a line attributes to a build across restarts and upgrades.

When operational telemetry is enabled (see [observability](observability.md)), the same records do double duty: lines logged inside a traced request gain `trace_id`/`span_id` fields, and every record is additionally exported over OTLP with trace correlation. The stdout stream is otherwise unchanged, and without a configured OTLP endpoint the logger behaves exactly as described above.

The logger's first and primary consumer is a **security audit trail**: a structured record at every security-relevant decision point, so a forensic investigation can reconstruct *who did what, to what, and whether it was allowed*. The trail is the orthogonal counterpart to [usage-tracking](usage-tracking.md): usage is **pseudonymized analytics** in Postgres (a database leak yields opaque hashes); the audit trail is **real-identity forensics** on stdout (an investigator can attribute directly). The two never share actor handling.

## The audit record

`securityLog(level, event, fields)` ([`core/security-log.ts`](../../packages/api-server/src/core/security-log.ts)) is a thin, typed wrapper over the Pino logger — not a new level or stream. The dotted `event` (e.g. `egress.decision`, `secret.create`, `authn.deny`) is the log message; the fields are merged into the line:

- **`category`** — the coarse class (`authn`, `authz`, `egress`, `approval`, `authz-list`, `credential`, `channel`, `resource`, `privileged`). The journal merges stdout and stderr into one stream, so a shipper isolates the trail by **filtering on this field**, not on the stream.
- **`actor` / `actorKind`** — the raw (un-pseudonymized) Keycloak `sub`, an agent id, `system:<component>`, or `null`; tagged `user | agent | system | external`.
- **`result`** (`success | failure`) and **`decision`** (`allow | deny | hold | expired`) are **separate axes** — an execution failure is not a policy deny, so the canonical "show me every deny" query stays unambiguous.
- **`correlationId`** ties a multi-site flow together. A credentialed-egress hold (`egress.hold`), the human verdict (`approval.verdict`), and the resolved decision (`egress.decision`) all carry the same pending-approval id.
- **`agentId`, `target`, `sourceIp`, `reason`, `detail`** round out the line. `detail` is shallow and value-free.

**Level mapping:** deny/fail → `warn`, allow/success/mutation → `info`, internal failure on a security path → `error`.

**Redaction is the caller's contract.** Records never carry token/secret/PAT values, refresh tokens, raw JWTs, or raw prompts — only metadata (`hasRefresh`, `secretId`, env key *names*, byte counts, a resolved file path). The bus saga projects explicit fields per event rather than spreading a domain event, so payload content can never leak into a record. The logger also censors a few well-known credential keys as defense-in-depth, and the WS edge strips `?token=` before logging a path.

## How the trail is produced

Two disjoint mechanisms feed the one logger:

- **Bus saga** ([`modules/audit`](../../packages/api-server/src/modules/audit)) — subscribes the in-process domain event bus for the discrete success/observation events that already carry a real actor: `ChannelTurnRelayed`, `ScheduleFired`, and `FilesImported`. It mirrors the usage `persist-activity` saga shape, but only for events that occur at most once per action — it deliberately does **not** subscribe `UserAuthenticated`, which fires on every authenticated request (the usage saga consumes that one, collapsing it to a single row per day).
- **Direct calls** at every decision/denial/mutation site not on the bus — the majority, and all denials. Each site logs at the application/service layer or the transport edge, where the actor is in scope; never in the pure domain layer.

## Coverage

| Surface | Representative events |
|---|---|
| Auth edge | `authn.deny` (bad/missing token), `authz.deny` (missing role), `authn.unavailable` (JWKS unreachable — request denied 503 without an authn verdict, no `decision` field). Successful logins are not logged here — the api-server only ever sees already-issued tokens on per-request verification; Keycloak's authentication-event log is the authoritative record of logins. |
| HTTP / WS edge | `authz.owner_mismatch` (cross-tenant agent access), `ws.authn_deny` / `ws.authn_unavailable` / `ws.owner_mismatch` / `ws.terms_block`, `relay.attach` (terminal/ACP attach to a credentialed sandbox) |
| Credentialed egress (HITL) | `egress.decision` (every allow/deny/expired), `egress.hold`; identity-unresolved and ext-authz transport denials |
| Approvals | `approval.verdict` (approve/deny once/permanent/host), `approval.verdict_conflict` (permanent verdict refused because an equivalent rule with the opposite verdict exists — the approval stays unresolved, so no `approval.verdict` line follows) |
| Authorization lists | `egress_rule.create|update|revoke|preset`, `secret.grants_set`, `connection.grants_set` |
| Credentials | `secret.create|update|delete`, `oauth.token_mint`, `connection.create|delete`, `secret.orphan_cleanup_failed` |
| Channels | `channel.authz` / `channel.authz_deny` (in-chat command authorization; Telegram group-admin gate), `channel.inbound.unauthorized` (unbound Telegram chat probing), `channel.turn` (inbound relay turn, prompt omitted; messenger-native driver id in detail), `channel.file.delivered` (an inbound attachment written into the workspace, by name and byte count — the trail's answer to who put a file there), `identity.link`, `channel.outbound` (agent post, incl. resolved attachment path and whether a threaded reply was broadcast to the whole channel), `channel.chat_bound` / `channel.chat_unbound` (binding grants; each has a `.notify_failed` warn sibling when the in-chat confirmation can't be delivered) |
| Privileged | `skill.install` / `skill.uninstall` / `skill.publish`, `skill.set.create` / `skill.set.delete` (a set is a reusable instruction to fetch code from named repositories), `schedule.create|toggle|delete` (incl. agent-driven), `usage.inspect` / `usage.inspect.deny`, `agent.create|update|delete|restart|wake` |

## Invariants

- **Single process, single stdout.** The public API, harness, and ext-authz gRPC apps run in one process, so one logger configuration and one stream cover the whole api-server.
- **Once per event.** The domain bus is in-process, and on one node that is the whole install: an event is emitted and consumed in the same process, and logged exactly once.
- **Non-blocking.** The egress gate logs on the proxy's request-blocking hop; the writer must never block or throw into a request path.

## Supervisor logging

The sandbox supervisor runs inside the api-server, so it logs through the same
Pino logger and lands in the same journal — there is no second log stream to
collect or correlate. Its lines carry the agent id and the reconcile phase.

The supervisor carries **no audit trail** of its own. It acts on the agent
record, never on behalf of a user, so there is no real actor to attribute — the
audit trail is solely an api-server concern.

## Gateway telemetry

The gateway runs Envoy, and Envoy is the one component that can neither host an in-process SDK nor be reached by zero-code auto-instrumentation — it is a C++ data plane, not an application runtime. So the gateway's observability is configured **natively in the rendered Envoy bootstrap** (the supervisor's bootstrap template). The exporter target has its own knob, decoupled from the supervisor SDK's env: under the bundled backend the node configuration sets `PLATFORM_GATEWAY_OTLP_ENDPOINT`/`_PROTOCOL` on the supervisor, pointing gateways at the collector's **OTLP/gRPC** port — gRPC because Envoy's stats sink speaks nothing else, and because the supervisor's own SDK is OTLP/HTTP-only, one shared endpoint could never serve both consumers. Without the override, the supervisor falls back to its inherited `OTEL_*` environment (the BYO-collector case; see [observability — platform-service export](observability.md#platform-service-export)). Either way the supervisor **relays the effective `OTEL_*` environment** onto each gateway and resolves everything at render time — endpoint, `OTEL_EXPORTER_OTLP_PROTOCOL` (OTLP/gRPC or OTLP/HTTP), and `OTEL_TRACES_SAMPLER`/`_ARG` translated into Envoy's sampling config, none of which Envoy reads natively. Collector authentication is **transport-level** — the gateway reaches the collector on the node, so no application-layer auth header is configured; the `OTEL_EXPORTER_OTLP_HEADERS` family is deliberately not relayed (Envoy can't consume it, and it may carry a credential). When no endpoint is present, the gateway emits nothing and behaves exactly as an uninstrumented platform. When one is, the gateway emits three signals: **traces** (the OpenTelemetry tracer on the outer egress listener), **access logs** (structured JSON on stdout, plus the same records exported over OTLP so they land in the telemetry backend beside every other platform service's logs — the same posture as the api-server's own logs), and **metrics** (Envoy's stats over an OTLP/gRPC sink — the admin interface stays disabled, so this push sink is the only stats egress). One caveat for BYO collectors that only accept OTLP/HTTP: traces and OTLP logs work over either transport, but the stats sink is gRPC-only, so such a deployment gets no gateway stats.

The gateway's own telemetry is **platform telemetry, not agent telemetry**: it exports directly to the collector (a separate path from the agent-telemetry transit chain with its trusted attribution — see [observability — trusted attribution](observability.md#trusted-attribution)), so it carries no `platform.agent.id` and is never attributed to a user. The producing gateway rides along as a bounded `platform.gateway.id` resource attribute instead — platform-namespaced (not `agent.id`) because agents can forge `agent.*` resource attributes in their own exports, and the collector sanitizes only the trusted attributes its gateways stamp (`platform.agent.id`, and the Invocation-target `platform.invocation.id`) — never `platform.gateway.id`. Note that only the base `OTEL_EXPORTER_OTLP_ENDPOINT` drives gateway telemetry: a deployment configured purely with per-signal `OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT` variables instruments the supervisor but leaves gateways dark.

Because the gateway injects upstream credentials on the wire, its telemetry is built so credential bytes never reach a span or a log line:

- **No credential in any record.** The access log never names the `Authorization` header, and it renders the request path through Envoy's `REQ_WITHOUT_QUERY` operator so the query string — where the credential injector parks query-parameter credentials — is dropped before the path is written.
- **Spans on the TLS-terminating chains, path-blind, and only where credentials are header-injected.** Chains whose credentials all inject into headers carry a tracing provider: they see the agent's decrypted `traceparent`, so their spans join the agent's trace and the ext_authz check inherits that context — this is what ties harness, gateway, and egress-approval spans into one trace. Their spans suppress the path tag (`max_path_tag_length: 1`), keeping agent-authored paths and query strings — which can hold agent-side secrets such as presigned URLs — out of span attributes; per-request detail stays in the query-stripped access log, joinable via the `x-request-id` span tag. Chains that move a credential into a URL query parameter stay untraced: post-injection `:path` carries the credential and Envoy has no query stripper for span tags. The egress decision for every credentialed request is on the api-server's audit trail (`egress.decision`) regardless.
- **Bounded cardinality.** Every gateway shares one trace/metric `service.name`; per-gateway identity rides as a bounded `platform.gateway.id` resource attribute, so cardinality does not scale with the agent count.
- **Trace context is stripped where the gateway can see it.** Plain-HTTP egress has `traceparent`/`tracestate` removed before the request reaches an external upstream; the internal harness route keeps them so a gateway span still links to the api-server's trace. TLS-intercepted requests are the exception: the credential-injection chains forward trace context to the upstream (on traced chains rewritten to the gateway's own span, same trace ID), and passthrough tunnels are opaque to the gateway entirely. So an upstream the agent talks to over TLS can observe the request's trace ID; what it can never observe is platform-side span data, which only ever goes to the collector.
