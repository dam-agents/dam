# Metrics (spend read path)

Last verified: 2026-07-24

## Overview

The **metrics** subsystem is the user-facing read path over agent telemetry: it answers *how much have my agents spent, and where* for the signed-in user. It backs the Settings **Usage** tab — per-model and per-session token/cost aggregates, monthly spend, and a per-agent spend breakdown — reading live from the columnar telemetry store that [observability](observability.md) fills. It is entirely a query surface: it owns no storage of its own, mutates nothing, and emits no events. The telemetry it reads is written by the agent **export** path and stamped with trusted attribution; this page picks up where that page's *user-facing read path is a separate concern* leaves off.

The subsystem is the **api-server's** responsibility end-to-end. It is a thin owner-scoped reader in front of the telemetry store — the controller and agent-runtime do not participate.

```mermaid
flowchart LR
  user[browser user]
  subgraph api-server[api-server]
    contract[metrics contract]
    service[owner-scoped service]
    reader[telemetry reader]
  end
  store[(telemetry store)]

  user -->|tRPC| contract
  contract --> service
  service -->|owned agent-id allowlist| reader
  reader -->|read| store
```

## Contract

Three read-only tRPC procedures make up the surface; all are query-only and all are scoped to the caller's own agents. The field-level shapes live in the contract package [`packages/api-server-api/`](../../packages/api-server-api/) — this page describes what each *means*, not its literal type.

- **Overview** — the everything-for-a-window read. Returns three parallel rollups over the same filtered set: token/cost **per model**, runtime **per session** (call count, summed request latency, token/cost totals, first/last timestamps), and the most recent **per-call** context rows. It composes three independent filters — an optional lookback window (capped at 30 days), an optional exact session, and a row limit on the unaggregated per-call rows — plus an optional narrowing to a single owned agent. Omitting all filters means *all of the caller's agents, all time*.
- **Spend** — the monthly-bill read. Returns token/cost **per model** over an absolute half-open `[from, to)` instant range, across *all* of the caller's agents. The range is instants rather than calendar fields on purpose: the client decides what a "month" means in its own timezone, and the server never reasons about calendars.
- **Spend by agent** — the same monthly `[from, to)` range read, but rolled up **per agent** and sorted highest cost first (no top-N cap). Grouping is on the trusted, gateway-stamped agent id — the same key every read scopes by; the display name is the latest `platform.agent.name` the telemetry carried in range, read from the rows themselves rather than joined against the live registry, so a since-deleted agent still shows its last known name. The name is display-only; the id remains the sole key and the sole authority for whose spend a row is.

The Overview session filter is **trace-aware**, not a literal session-id match: a queried session folds in every session that shares a trace with it, so a child harness run the session spawned (a `claude -p` subshell, a `dam-run` executor) counts under "this session" even though it minted its own session id. That fold rides the same trace-context propagation [observability](observability.md#agent-export) describes, and it never crosses the ownership boundary — both sides of the fold carry the same owner scope.

## Ownership scoping

Every read is scoped to the agents the caller owns; the scope is resolved **in the service layer**, above the store. The service resolves the caller's owned agent IDs into an allowlist and hands only that allowlist to the reader, which does no scoping of its own — it filters unconditionally on the trusted owner attribute. A caller can never widen the scope through input: naming an agent they do not own resolves to an empty allowlist, and an empty allowlist yields no rows rather than an error. When a specific agent is requested, the same API-key binding check the rest of the agent-read surface applies is layered on top.

The owned set is the **union of the caller's live agents and the historical agent registry**, deliberately including deleted agents. Spend history is a bill: it must not shrink retroactively when an agent is deleted. Scoping only to live agents would erase a deleted agent's past spend from every window that overlaps its lifetime, so the registry keeps deleted agents in scope and their telemetry keeps counting for as long as the store retains it.

## Telemetry reader

The reader is the only component that speaks to the telemetry store. It holds a process-wide read connection and translates each contract read into an aggregate query against the store, always gated on the owner allowlist plus the request's window filters.

It reads the per-LLM-call log records Claude Code exports — one record per API call — and depends on a small, stable slice of their shape: the trusted **owner attribution** attribute (every query's ownership gate), the **session** and **trace** identifiers (session grouping and the trace-aware fold), the **model** name, the **timestamp** (windowing and first/last bounds), and the per-call counters it sums — the **token counters** (input, output, cache-read, cache-creation) and the **cost counter**, which is carried in integer micro-dollars and scaled to dollars at read time. The per-agent breakdown additionally reads the agent's **display name** attribute — never for scoping, only to label a row — taking the latest value seen in the window so a deleted agent keeps a readable name. This is a coupling to the harness's export contract, not to platform code; the exact attribute keys and query text are the reader's own detail in [`packages/api-server/`](../../packages/api-server/). The reader scopes to Claude Code's per-call records by the record body alone — not by service name, which carries the agent's *template* name and would hide every template not literally named for the harness.

## Disabled backend

The telemetry store is optional (it ships with [observability](observability.md), disabled by default). When no store endpoint is configured, the metrics service is wired to a **disabled** variant whose every read fails loud with a `PRECONDITION_FAILED` error rather than returning empty results. Failing closed is deliberate: an empty success is indistinguishable from "no spend yet" and would silently misreport a bill as zero. The Usage tab treats that error as *metrics unavailable on this deployment* and shows an unavailable message, distinct from the empty-but-enabled state where a real store simply has no rows for the window.

## Trust story

Attribution is trustworthy; the numbers are self-reported. The two guarantees are different and this subsystem inherits both from the export path — see [observability — trusted attribution](observability.md#trusted-attribution) for the mechanism.

- **Counters are agent-reported.** Token and cost figures come from the agent's own telemetry. An agent runs untrusted code and can misreport its own numbers — inflate a token count, understate a cost. The read path does not attempt to independently verify them; it reports what was exported.
- **Attribution is gateway-stamped and unforgeable.** The owner attribution attribute every query filters on is stamped by the agent's paired gateway, overwriting anything the agent set, and the collector drops any owner attribution that did not arrive through that gateway. So an agent can only ever pollute *its own* spend — never make its telemetry appear under another user, and never read another user's. The guarantee is **attribution, not content integrity**: whose spend is bounded exactly; how much is self-declared.
- **Display identity is not attribution.** The agent's user-facing name travels in a separate, agent-exported attribute that exists only for finding an instance in the exploration UI. It is display-only and never used for scoping or ownership — the gateway-stamped id is the sole authority for whose data this is.
