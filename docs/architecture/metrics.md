# Metrics (the usage read path)

Last verified: 2026-07-23

## Overview

**Metrics** is the user-facing read path behind Settings ▸ Usage: it answers
*what have my agents spent* — LLM token consumption and dollar cost, rolled up
per model, per session, and per call, always scoped to the calling user's own
agents. It reads live from the telemetry store; it stores nothing of its own
and does not aggregate ahead of time.

It is the read counterpart to [observability](observability.md), which owns the
**export** path — how agents emit telemetry and how it lands in the store — and
deliberately scopes the read side out. This page owns that read side. The two
never overlap: observability puts signals in the columnar store and guarantees
who produced them; Metrics reads a slice of those signals back for one user.

Metrics is distinct from [usage-tracking](usage-tracking.md), which is activity
analytics — an append-only, pseudonymized log of *interactions* (auth, channel
turns, schedule fires) in Postgres. Tokens and cost are **Spend**, and Spend
lives here, over telemetry — not in usage-tracking.

## The contract

The api-server exposes Metrics as two owner-scoped, read-only tRPC procedures.
Both return only data for agents the caller owns; neither ever mutates.

- **Overview** — the whole Usage panel in one read: per-model token/cost
  totals, a per-session runtime roll-up (call count, summed latency, tokens,
  cost, first/last timestamps), and the most recent unaggregated per-call rows.
  Filterable by an optional lookback window, an optional single agent, an
  optional single session, and a row cap on the per-call slice. A specific
  agent additionally passes the API-key binding check that gates the rest of
  the agent-read surface.
- **Spend** — per-model spend over an absolute, half-open time range across
  *all* of the caller's agents. The range is passed as instants, not calendar
  fields, so the client decides what a "month" means in its own timezone; this
  is what the month-stepper in the Usage view drives.
- **Spend by agent** — the same range and ownership scoping as **Spend**, but
  rolled up per owning agent instead of per model, sorted by cost descending
  with no top-N cap. Grouping is on the gateway-stamped `platform.agent.id`
  (the trusted attribution key); the display name is the latest
  `platform.agent.name` observed in range, so a deleted agent keeps a readable
  label. The name is display-only — the id stays the key. The Usage view renders
  it as a horizontal-bar breakdown driven by the same month-stepper.

Field-level shapes live in the contract package
([`packages/api-server-api/src/modules/metrics/`](../../packages/api-server-api/src/modules/metrics/)) —
follow the link rather than restating them here.

## Ownership scoping

Scoping is enforced in the **service layer**, not in the store reader. The
service resolves the caller's owned agent IDs up front and hands the reader a
fixed allowlist; the reader filters every query on that allowlist and does no
scoping of its own. Requesting an agent the caller does not own resolves to an
empty allowlist, and the read then yields nothing — that empty result *is* the
ownership guarantee, not an error.

The owned-agent set is the **union of two sources**: the user's live agents and
the Postgres agent registry (the [Agent Mirror](usage-tracking.md)). Live
agents alone would shrink the set the moment an agent is deleted, so a user who
deletes an agent would see last month's spend drop retroactively. Unioning in
the registry keeps deleted agents in scope: **history must not shrink**. Spend
already incurred stays attributed to the user who incurred it, forever.

## The store reader

The reader queries the same columnar telemetry store the
[observability](observability.md) export path fills: one telemetry log record
per LLM API call, emitted by the Claude Code harness. Each record carries, in
its attribute maps, the counters Metrics rolls up — input/output token counts,
cache-read and cache-creation token counts, cost in micro-dollars
(`cost_usd_micros`, divided back to dollars at the boundary), the model name,
the call duration, and the event timestamp — plus the trusted `platform.agent.id`
that scopes every query. The exact query text and column mapping live in the
reader ([`packages/api-server/src/modules/metrics/infrastructure/`](../../packages/api-server/src/modules/metrics/infrastructure/)).

Two shape facts are worth stating because they are couplings, not incidental:

- The store returns 64-bit integers as strings to avoid precision loss, so
  every numeric column is coerced back to a number at the read boundary.
- A session query folds in **whole sessions that share a trace** with the
  target session, not just rows carrying the same session id. This is what
  makes child harness runs (a `claude -p` subshell, a `dam-run` executor) count
  under the session that spawned them — they mint their own session id but
  inherit the parent's W3C trace context. See
  [observability — agent export](observability.md#agent-export) for why child
  runs carry the parent trace but a fresh session id.

## When the backend is disabled

The telemetry store is optional and off by default (see
[observability](observability.md)). When no store URL is configured, the
api-server wires a **disabled** Metrics service in place of the real one: every
read fails loud with a `PRECONDITION_FAILED` error rather than returning an
empty result. Failing is deliberate — an empty success would read as "no spend
yet" and quietly mislead. The Usage view maps that error to a plain *metrics
are unavailable on this deployment* message, distinct from the *no spend in
this range* empty state.

## Trust story

Metrics inherits the trust boundary from [observability](observability.md), and
the distinction is what makes the numbers safe to show a user:

- **Counters are agent-reported.** Token counts and cost come from the agent's
  own telemetry. A compromised agent can inflate or understate *its own*
  numbers — Metrics does not independently verify them. The blast radius is
  bounded to that agent's own owner: it can pollute its own figures, never
  anyone else's.
- **Attribution is gateway-stamped and unforgeable.** The `platform.agent.id`
  that ties each record to an agent is stamped by the agent's paired gateway on
  the way out and cannot be set or overwritten by the agent. This is the whole
  reason owner scoping is sound: a forged attribute never survives, so an
  agent can never make its spend appear under another user.
- **Agent name is display-only.** The `platform.agent.name` an agent exports is
  a self-declared label for finding an instance; it carries no authority and is
  never used for scoping or attribution. Only the gateway-stamped id is trusted.
