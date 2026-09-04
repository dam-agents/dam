# Observability (agent telemetry)

Last verified: 2026-09-04

## Overview

The telemetry backend is an **optional, bundled subsystem** that receives and stores the OpenTelemetry signals (logs, traces, metrics) agents emit — the substrate for answering *how agents run*: token consumption, cost, per-sub-agent breakdown. This page covers the backend (receiving and storage) and the agent **export** path that feeds it (see [Agent export](#agent-export)); the user-facing read path is a separate concern, owned by [metrics](metrics.md).

It is implemented with **ClickStack**: a columnar telemetry store (ClickHouse) fronted by an exploration UI (HyperDX), plus a separate document store backing that UI's own application state. Installing or upgrading the platform brings the stack up when it is enabled, but it is **disabled by default** — it is a heavy, multi-pod stack, and until agents are wired to export it would receive nothing, so operators opt in per install.

## Topology and roles

```mermaid
flowchart LR
  exporters[agent exporters]
  subgraph cluster[Platform install]
    collector[OTel collector]
    store[(telemetry store)]
    ui[exploration UI]
    appstate[(UI app state)]
  end
  exporters -->|OTLP| collector
  collector -->|write| store
  ui -->|read| store
  ui --> appstate
```

- **Collector** — an OpenTelemetry collector that receives OTLP and writes the signals into the telemetry store. It is platform-owned (deliberately not the collector ClickStack bundles — see *Access control*) and holds no upstream credentials; it only ingests telemetry.
- **Telemetry store** — a columnar analytical database built for high-volume, high-cardinality, time-series telemetry. It is the only place telemetry lives. Retention is bounded: when the collector first creates the telemetry tables it stamps them with a TTL — 30 days by default, overridable per install through the chart — so signals age out instead of accumulating until the volume fills. The TTL lands only at table creation; changing it on an existing install means altering the tables by hand.
- **Exploration UI** — reads the telemetry store directly so an operator can explore signals. Its own application state (dashboards, sources, saved views) lives in a separate document store that holds no telemetry.

The whole stack sits inside the cluster trust boundary.

## Operators are install-time infrastructure

The telemetry store and the UI's app-state store are managed by Kubernetes **operators** driven by custom resources. Like the service mesh and the certificate manager, those operators and their CRDs are installed out-of-band at cluster-install time rather than by the platform chart: Helm never upgrades a chart's CRDs on an existing release, so CRD-owning infrastructure stays outside the chart. The chart ships only the custom resources and the platform-owned collector, which roll with an ordinary platform upgrade.

## Access control: the mesh, not ingestion tokens

ClickStack's default posture secures the collector with an ingestion key the UI issues and manages — application-layer, token-based access control. The platform deliberately does **not** rely on that. The collector is gated the same way as the rest of the platform: by the **service mesh**, through an authorization policy that admits only the platform's own namespaces — the release namespace and the agent namespace — and denies everything else. This keeps telemetry access on the same SPIFFE-principal model as the rest of the system (see [security-and-credentials](security-and-credentials.md)) rather than introducing a parallel token scheme.

Making the mesh the sole gate is why the collector is platform-owned. ClickStack's bundled collector takes its configuration — including the ingestion-key check — dynamically from the exploration UI, so that configuration cannot be the access boundary here. The platform instead runs its own collector with a fixed configuration and no key enforcement. The UI is unaffected: it reads the telemetry store directly, not the collector.

## Agent export

Harnesses produce telemetry by exporting it themselves over OTLP — the platform does not scrape or tap it. Export turns on with the backend: enabling `clickstack.enabled` stands up the collector, the gateway's collector egress chain, and the [trusted attribution](#trusted-attribution) below, and configures the harness to export to the collector. A per-template `telemetry` flag opts a harness in **and names which env rail it gets**, because no two harnesses read the same export configuration. Two rails exist today — Claude Code's and Bob Shell's — and both land on the same collector over the same gateway egress; a third harness means a third rail, not a change to anything downstream.

- **Rides the agent's ordinary egress.** The exporter honours the agent's `HTTPS_PROXY`, so telemetry leaves through the paired gateway pod over HTTPS to the bundled collector — the same dedicated, MITM-terminating chain that performs the trusted attribution below. No new network path, and no credential is injected into the export. This is a **precondition, not a convenience**: the collector is reachable no other way, and an exporter that ignored the proxy would also miss the attribution stamp, so its records could never be attributed to a user. Honouring it is not automatic — an exporter built on a runtime's raw HTTP client obeys the proxy only because the agent env asks that runtime to, which is what makes Bob's OTLP export work unchanged.
- **Config travels the harness env rail.** The OTLP environment (enable flag, per-signal exporters, endpoint, protocol, flush intervals) reaches the harness through the same runtime channel that carries connection env — not a pod-level Secret or env.
- **Signals.** Claude Code exports metrics, logs, and traces (the last via the enhanced-telemetry beta) over OTLP/HTTP, with one **log record per LLM call**. Bob Shell exports **traces only**, and its per-call counters ride a generation span under GenAI semantic-convention names — there is no log-record equivalent to fall back to, which is why the [metrics](metrics.md) read path normalizes both shapes rather than reading one. Bob additionally gates those spans behind its own agent-operations switch, so the rail turns it on explicitly; without it the harness exports its lifecycle spans and none of the spend.
- **Content bodies are not exported** — prompt text, tool arguments, and raw API bodies stay off; only structural telemetry (durations, model/tool names, token and cost counters, span shape) leaves the agent. Claude Code omits them by default. Bob **includes** them by default, so its image writes the payload-exclusion setting into the harness's own configuration at startup rather than relying on the env rail: the invariant is the platform's, and a harness that defaults the other way must be corrected where it reads its settings.
- **Self-declared identity for exploration.** On the Claude Code rail the export env names the OTel service after the agent's **template** (so a nous agent reads as `nous`, not as the underlying Claude Code CLI's default), and seeds the user-declared agent name as a `platform.agent.name` resource attribute, kept current on rename. Both are exported by the harness itself and exist for finding an instance in the exploration UI — they are **display-only**; attribution rests solely on the gateway-stamped `platform.agent.id` below. Bob supplies **neither**: it fixes its own service name and builds its resource attributes internally, reading no standard OTel resource environment, so its signals are findable by service and by trusted agent id but not by the user's name for the agent. That the gap is tolerable is the same point — nothing but exploration ever depended on those two. This split is what lets an Invocation target keep its own name in the UI while its spend merges into the Driver that drove it (see [trusted attribution](#trusted-attribution)).
- **Trace-context propagation stays on.** The harness keeps W3C trace-context propagation on even when it fronts a custom model upstream — a case where it would otherwise switch it off — so its subprocesses inherit the session's trace context and its requests carry the `traceparent` header. The gateway's TLS-intercepting chains that see the decrypted header join their spans — and the egress-approval check's api-server spans — to that same trace, so a model request reads as one trace across harness, gateway, and api-server. See [logging — gateway telemetry](logging.md#gateway-telemetry) for which chains are traced and what never reaches a span.
- **Child harness runs fold into their session.** A harness run the session spawns rather than serves — a `claude -p` in a subshell, a command under the `dam-run` shell shim — mints its own OTel `session.id` but inherits the session's trace context, so its records carry the parent trace's `TraceId`. The session-scoped metrics read path folds in every session that shares a trace with the queried one — whole sessions, since a child's warmup calls carry no trace — so "this session" covers the runs the session spawned, not only its own API calls. One wrinkle makes the subshell case work at all: the harness scrubs `OTEL_*` from the env it hands Bash-tool subprocesses (while forwarding `TRACEPARENT`), so the Claude Code image mirrors the `OTEL_*` env into the harness settings file at spawn, where a child `claude -p` re-applies it at startup.

## Platform-service export

The platform's own services emit their operational telemetry through an in-process OpenTelemetry SDK apiece. Enabling the backend sets the standard OTLP endpoint environment on each deployment, pointing straight at the bundled collector over plain HTTP inside the mesh (ztunnel supplies mTLS, and the collector's authorization policy already admits the release namespace); without that endpoint the SDK never activates. Unlike agent telemetry, this export does not ride a gateway: it arrives without the trusted attribution header, so it carries no `platform.agent.id` and is never attributed to a user — which is exactly how the read path distinguishes platform telemetry from agent telemetry.

- The **controller** emits one trace per reconcile pass and background sweep (with spans for each Kubernetes API call), reconcile and workqueue metrics, and its structured logs with trace correlation.
- The **api-server** emits one trace per incoming request with a child span per tRPC procedure (and spans for outbound calls: agents, Keycloak, channels, Redis, the ext-authz gRPC checks), per-procedure duration/outcome metrics plus Node runtime health (event loop, GC, heap), the **turn counter** below, and its structured logs with trace correlation. Health-probe requests are not traced. The primary Postgres pool is not yet instrumented (no driver instrumentation exists for it); that gap is tracked as follow-up work.

### Turn counter

This is a **deliberate second sink** on the turn events [usage-tracking](usage-tracking.md) persists: that subsystem owns the durable, per-user record and its SQL read surface, while this counter serves the operational read — a rate on a dashboard, reachable without SQL and without that subsystem's reader role. Both are fed from the same events, so the definition of a turn is shared rather than reimplemented. It is a subscriber on the same turn events that subsystem persists, so both sinks answer to one definition of a turn rather than each counting their own way. They are not guaranteed to agree in practice: each is separately enabled — the counter needs the SDK active, the log needs activity tracking on — and each fails independently, so treat a divergence as a sink being off or dropping, not as two different notions of a turn.

Its one dimension is the **surface** that carried the turn, taken from the event — for a relay turn the surface the upgrade resolved from the caller's own credential, and for a channel turn its messenger. A failed turn counts like any other, because the counter measures what was asked rather than what came back.

Two limits are worth knowing before charting it. A read-along turn is indistinguishable from one that addressed the agent, since the channel turn event carries no such marker, so a channel with read-along enabled reads higher than the attention it actually received. And terminal-mode sessions never appear at all: a PTY is an opaque keystroke stream with no message boundary, which is also how the CLI chats.

Outcome and agent identity are deliberately absent. Outcome is known only on the channel side, and a dimension present on some surfaces and not others makes any filter on it silently drop the rest; per-turn outcomes stay in the activity log's channel views. Agent identity would multiply series by the fleet size for a question that does not need it — and were it ever added it must not reuse the trusted agent attribution attribute, whose **absence** is what marks a signal as platform telemetry rather than agent telemetry.

## Trusted attribution

Telemetry only answers *whose agents ran, and how* if each record is reliably tied to the agent that produced it — and agents run untrusted code, so the attribution cannot be taken from what the agent put in its own telemetry. It comes instead from the platform-controlled path the telemetry already travels.

Every agent's egress, telemetry included, leaves through its **paired gateway pod**: the agent has no other admitted route (see [security-and-credentials](security-and-credentials.md)), and the gateway proxy's configuration is controller-rendered, not agent-writable. When the telemetry backend is enabled, that gateway proxy intercepts any agent OTLP bound for the collector and stamps a trusted `platform.agent.id` identifying the producing agent — **overwriting** anything the agent set, since the value is fixed in this gateway's own per-agent configuration. The collector then promotes that value to a `platform.agent.id` resource attribute on every signal in the request, and **drops any agent-supplied `platform.agent.id` that did not arrive from the gateway**, so a forged value can never survive.

The guarantee is **attribution, not content integrity**: an agent can still misreport its own numbers (inflate a token count), but it can only ever pollute *its own* telemetry — never make its telemetry appear under another agent or user. The owner-scoped read path resolves `platform.agent.id` to the owning user; telemetry that carries no `platform.agent.id` (the platform's own components) is not agent telemetry and is never attributed to a user. The attribute is namespaced under the permanent `platform` codename so it never collides with OpenTelemetry semantic-convention or agent-self-reported `agent.*` attributes.

**Invocation targets attribute to their Driver.** An Invocation target is not a spend principal of its own — the same rule [Egress Aliasing](../ubiquitous-language.md) applies to network identity and Driver Cascade to deletion, here in its spend face. So a target's gateway stamps its **root Driver's** id as the trusted `platform.agent.id`, not the target's own, and every record the target produces counts as the Driver's from the first export. To keep the merged child rows distinguishable, the same gateway additionally stamps a trusted `platform.invocation.id` carrying the target's *own* id; the collector promotes it with the same drop-then-stamp sanitization, so it too is unforgeable. A non-target's gateway **strips** any `platform.invocation.id` an agent tries to smuggle in, so the attribute only ever appears on genuine target rows. The target's `platform.agent.name` stays its own and remains display-only. This attribution is fixed at **spawn (write) time**: the api-server resolves the root Driver when it creates the target and bakes the override into that gateway's controller-rendered configuration, so it is settled before the target's first call and never recomputed at read time.

## Persistence

The telemetry store is a **fourth durable substrate** beyond the three in [persistence](persistence.md) (Postgres, the Agent/Run custom resources, the per-Agent PVC), and it sits outside that platform/agent split — neither the agent nor the controller touches it. Both the telemetry data and the UI's app-state persist on operator-managed volumes that survive pod restarts and a chart uninstall; losing those volumes loses telemetry history and nothing else depends on them for correctness. When the subsystem is disabled, none of it exists.

## Relationship to logging and usage-tracking

This subsystem is distinct from two neighbours, and overlaps one of them on purpose:

- [logging](logging.md) owns structured operational logs and the real-identity security audit trail, emitted to stdout.
- [usage-tracking](usage-tracking.md) owns pseudonymized usage analytics in Postgres — an append-only activity log read through SQL views. The [turn counter](#turn-counter) above is a **second sink on that subsystem's turn events**: the same fact, read operationally as a time series rather than analytically through SQL. Turn *volume* is therefore answerable from either side, and the split is by read pattern, not by what is counted.

Telemetry here is the OpenTelemetry-native, explorable signal pipeline: a different store (columnar, not Postgres), a different shape (OTLP logs/traces/metrics), and a different read surface (the exploration UI). Postgres remains the right home for coarse usage analytics; it cannot serve high-volume telemetry, which is the reason this subsystem exists at all.

See [`deploy/helm/platform/`](../../deploy/helm/platform/) for the chart shape — the `clickstack` values block, and the collector and authorization policy under `templates/clickstack/`.
