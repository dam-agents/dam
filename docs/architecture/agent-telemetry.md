# Agent Telemetry (trace and log read path)

Last verified: 2026-09-24

## Overview

**Agent telemetry** is the user-facing read path over the raw signals an agent
produced: the **Telemetry Traces** it emitted, the **Telemetry Spans** inside each one, and
the **Telemetry Log Records** those spans carry. It answers *what did my agent actually do,
and where did the time and money go in this exchange* — the structural counterpart to
[metrics](metrics.md), which answers *how much have my agents spent*.

Both read the columnar telemetry store that [observability](observability.md) fills, and
both scope every read to the agents the caller owns. They are separate subsystems because
they answer different questions and hold **opposite invariants on emptiness**: an empty
spend read would misreport a bill as zero, so metrics fails closed; an empty telemetry read
is a legitimate answer — this agent produced no telemetry in this window — so this path
reports availability as a value and never turns "nothing happened" into an error.

The read path is the **api-server's** responsibility end to end: a thin owner-scoped reader
in front of the telemetry store, in which the controller and agent-runtime take no part. The
one place the agent side participates is the join of a reply to its Turn, which rides the
Session load — the harness image's session-history provider stamps each replayed reply with
the prompt id of the message it answered, and agent-runtime replays that history
([progressive disclosure](#progressive-disclosure)).

```mermaid
flowchart LR
  user[browser user]
  tooling[API / export client]
  subgraph api-server[api-server]
    contract[telemetry contract]
    service[owner-scoped service]
    fold[log/span correlation]
    reader[telemetry reader]
  end
  store[(telemetry store)]

  user -->|tRPC| contract
  tooling -->|tRPC or NDJSON export| contract
  contract --> service
  service --> fold
  service -->|owned agent-id allowlist| reader
  reader -->|read| store
```

## The unit is a Turn, not a trace

A **Turn** is everything one exchange produced: the records the harness stamped with one
prompt id, and the spans that belong with them. It is deliberately **not** the OpenTelemetry
trace.

What a trace holds is the harness's business and varies from one exchange to the next —
sometimes a whole exchange, sometimes one model call, sometimes nothing at all — so grouping
on it gives one exchange several shapes and another none.

Keying on the **prompt id** needs none of that structure. The harness assigns every prompt an
identifier and stamps it on each log record that prompt causes until the next one; every
record carrying the same id is one Turn, whatever the harness did or did not span in
between, and the id is the Turn's identity — stable across polls, where a start time would
move as late records land. Spans carry no prompt id. A span joins the Turn whose records
share its trace, or, when those records carry no trace, the Turn whose records surround its
start — padded by the few milliseconds a root span opens before the prompt record. A Turn
therefore reports how much structure it happens to have — how many spans, how many records,
which traces it touched — rather than depending on that structure to exist.

Records the harness did not stamp — the session's housekeeping, and everything an older
harness emitted — fall back to grouping on time: ordered by timestamp and cut at each prompt
record or root span, with a leading region split on an idle gap. Which rule made a Turn
travels in the response, so a consumer can tell a keyed Turn from an inferred one.

**This is why the surface lives inside the conversation.** One Turn is one exchange, so a
Turn belongs to a reply rather than to a list beside it. Reaching a keyed Turn's detail is a
prompt id within a Session; an inferred Turn is reached by its time range. Neither is a trace
lookup — which is what lets a Turn hold spans from several traces, or from none.

## Correlating a log record to the call it describes

The purpose of the surface is to show, on the bar for a model call, what that call cost.
Two facts make that harder than it looks, and together they decide the design:

- The **cost is only on the log record**. A model-call span carries token counts; the
  per-call currency figure exists on the record alone, so the two must be joined for a
  waterfall to show spend at all.
- The record's own span identifier is **unreliable and often absent**. Where it is set it
  names the *enclosing* span — the turn, or the tool being run — rather than the model call,
  because the harness creates the call span without making it the active one. Where no
  enclosing span exists it is empty.

The join therefore prefers a **request identifier** the harness stamps identically on the
record and on the call span. Attachment resolves in three steps and every step renders:
by request identifier onto the exact call; failing that, by the record's own span
identifier onto its enclosing span; failing that, to the trace itself, positioned on the
timeline by its timestamp. **Which step was used travels in the response**, so a consumer
can tell an exact attachment from an approximate one instead of trusting a position it
cannot verify. The fold happens in the service layer, above the store and below the
contract, so the API and the UI see one correlated tree and the rule has one place to be
tested.

## Ownership scoping

Every read is gated on the trusted, gateway-stamped owner attribution attribute and
nothing else — never the service name, which carries the agent's Template, and never an
owner field inside a record body, which is present on platform records that carry no owner
scoping of their own. Scope resolves in the service layer, above the store: the service
turns the caller's owned agents into an allowlist and hands the reader ids alone. Naming an
agent the caller does not own yields an empty allowlist, and an empty allowlist returns no
rows without issuing a query. The owned set is the same live-plus-historical union
[metrics](metrics.md#ownership-scoping) resolves, so a deleted agent's telemetry stays
readable for as long as the store retains it.

**Only agent-attributed records are served.** The platform's own components emit spans onto
the same traces — the gateway hop and the api-server work behind a model request — and
those records carry no owner attribution. They are excluded, so a trace shows what the
agent did and not what the platform did around it. Two reasons, either sufficient: a record
without owner attribution is not provably platform-produced, and the unattributed set also
holds the platform's operational log stream, which carries real identities that owner
scoping never governed. Serving the platform side of a trace is a later step that depends
on provenance being positively established at ingest rather than inferred from an absence.

Every read is scoped to the agents the caller owns before it reaches the store, so an agent
the caller does not own contributes no rows: an empty allowlist returns nothing without a
query rather than confirming or denying what that agent produced.

## Reading the store

The reader is the only component in this subsystem that speaks to the telemetry store; it
opens its own connection to the same store the spend reader uses rather than sharing one
client. Every read is **bounded by a window in the contract** — a relative span of hours for
a listing, and an explicit range for one Turn, which the contract caps at a few hours. A
capped read takes the **newest** rows of its window and re-sorts them into time order, so a
cap that binds drops the oldest rows and never the newest — the exchanges beside the reply a
reader is looking at. Each query also carries execution-time and rows-read ceilings and
**fails rather than truncating silently**, since a short answer rendered as complete is the
failure worth designing against. Where a cap does bind, the response says so and the surface
reports it.

Spend per Turn is read from the log side and merged with the span side in the service, so
neither query has to span two tables.

## Contract

Four owner-scoped reads, all query-only. The Turn reads are scoped to one owned agent and
one Session, or to an Invocation target the caller drove; the record read narrows on request. The field-level shapes live in the contract package
[`packages/api-server-api/`](../../packages/api-server-api/).

- **Turns** — the listing for one Session over a window: when each Turn started, how long it
  took, how many spans and records it holds, which traces it touched, which models it called,
  and what it cost.
- **Turn** — one Turn in full, addressed by its prompt id within a window, or by its time
  range when it has none: its spans, its log records, and the resolved attachment between
  them. Addressed by an Invocation target instead of a Session, it holds that target's run.
- **Invocation turns** — one Turn per Invocation target the caller names, each covering the
  target's whole run. A target answers a single prompt, so its records and spans are summed
  as one exchange rather than split by prompt id; a target with no rows is absent, not zero.
  This is how a driver's delegation reads the same numbers its own replies show.
- **Log records** — a flat read across traces, filtered by Session, by event, or by a text
  match over the record and its attributes; the way to answer *what did my agent do* without
  starting from a trace.

Every read answers either an availability failure or a result, never an error for an empty
window — see the emptiness invariant above.

### Bulk export

A separate authenticated route serves the same owner-scoped records as newline-delimited
JSON, one object per line, for spans or for log records over a window. It buffers the rows
under a cap rather than streaming from the store. It exists because
the point of the subsystem is that a user can take their agents' telemetry elsewhere, and a
typed query response is the wrong shape for that. It is bounded by a row cap and says so in
the response when the cap binds.

## Progressive disclosure

The in-product surface is **inside the conversation**, not beside it. Each agent reply
carries a one-line summary of what that exchange cost and how long it took, which expands
in place to the exchange's own timeline. There is no separate panel and no list of turns to
cross-reference against the transcript: the transcript *is* the list, and a row of telemetry
belongs to the message above it.

A Turn is matched to its reply **by the prompt id**, which a reply learns when the Session is
loaded: the history the harness replays stamps each reply with the prompt id of the message
it answered, by position, so the join is authoritative once loaded. This is deliberately not
attempted live off the harness's stop hook — that report names only its Session, never which
Turn, so a report that outran its Turn would attach to the wrong reply; the correlation stays
on the load path, where position settles it. A reply still being watched live has not learned
its id yet and falls back to the prompt's **time**: the Turn belongs to the exchange whose
prompt was the latest sent at or before the Turn began *and* whose next prompt, if one has
been sent, came after it — bounded at both edges, so the reply to one prompt can never claim
the Turn the next prompt started while that Turn's own reply is still on its way. A few
seconds' slack covers a sender's own message, which keeps the browser's stamp until the
Session is reloaded: it tolerates at the lower edge and tightens at the upper. A keyed match
is never displaced by a timed one, a reply still streaming shows nothing until it settles,
and a reply with neither an id nor a time stays unlabelled rather than being lined up by
position.

Session-wide access stays off the conversation: the Session's own menu exports its telemetry
as a file. The panel is revealed by an experimental feature ([features](features.md)); the
procedures themselves stay open to any authenticated owner. The flag is disclosure, not
authorization — the raw view is deliberately structural, and the designed diagnostic
experience it feeds is separate work. The API and the export are therefore usable before the
surface is revealed.

## Disabled backend

The telemetry store is optional and off by default. With no store configured the service is
wired to an **unavailable** variant that reports its unavailability as a value with a
reason, rather than throwing. This is the deliberate inverse of the spend path's
fail-closed posture, for the reason given in the overview, and it also serves the
programmatic consumer, which needs to record "telemetry is not measured on this install"
and carry on. Both variants are chosen once at composition time.

## Trust story

Inherited whole from the export path: **attribution is unforgeable, content is
self-reported**. The owner attribution every query filters on is stamped by the agent's
paired gateway and sanitized at ingest, so an agent can pollute only its own telemetry. The
records themselves — durations, span names, token and cost counters — are what the agent
exported, and this path reports them without independent verification. See
[observability — trusted attribution](observability.md#trusted-attribution) for the
mechanism and its current limits.

One consequence is worth stating plainly because this surface makes it visible for the
first time: an agent bound to a Channel is driven by whoever the messenger admits, and
those turns are attributed to the agent's owner. The owner therefore reads structural
detail — tool names, call sequencing, timings — about work a third party asked for.
Message content is not exported and so is not shown, but the behaviour is.
