# Metrics (spend read path)

Last verified: 2026-10-16

## Overview

The **metrics** subsystem is the user-facing read path over agent telemetry: it answers *how much have my agents spent, and where* for the signed-in user.
It backs the **earlier estimates** on the Settings Usage tab: for 30 days after the measuring start, the user can open the spend that each agent reported about itself, with per-model token/cost aggregates, monthly spend per day, spend per session kind and a per-agent spend breakdown, read live from the columnar telemetry store that [observability](observability.md) fills.
Every other figure on the Usage surfaces — the Settings tab, the per-agent section, Home's spend card and each agent's spend summary — reads Metered Spend, which the gateway measures ([spend-limits](spend-limits.md#screens)).
The cost of each Session in the sidebar and of each chat turn reads Metered Spend too ([spend-limits](spend-limits.md#screens)).
It is almost entirely a query surface: it mutates nothing and emits no events.
Spend is the only question it answers; the raw traces and log records behind those numbers are read by [agent-telemetry](agent-telemetry.md), which opens its own connection to the same store and shares this subsystem's owner scoping but inverts its fail-closed posture on an empty result.
The one thing it does own is a **session directory** — a projection of which kind each Session was, without which spend cannot be attributed to how the work was started (see [session directory](#session-directory)).
The telemetry it reads is written by the agent **export** path and stamped with trusted attribution; this page picks up where that page's *user-facing read path is a separate concern* leaves off.

The subsystem is the **api-server's** responsibility end-to-end.
It is a thin owner-scoped reader in front of the telemetry store — the controller and agent-runtime do not participate.

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

Two read-only tRPC procedures make up the surface; both are query-only and both are scoped to the caller's own agents.
The field-level shapes live in the contract package [`packages/api-server-api/`](../../packages/api-server-api/) — this page describes what each *means*, not its literal type.

- **Overview** — the everything-for-a-window read.
  Returns three parallel rollups over the same filtered set: token/cost **per model**, runtime **per session** (call count, summed request latency, token/cost totals, first/last timestamps), and the most recent **per-call** context rows.
  The per-session rollup groups each session under the **root session of its trace family**: a child harness run the session spawned (e.g. a `claude -p` subshell) mints its own session id but inherits the parent's trace context, so its spend folds into the spawning session's row instead of appearing as an orphan — a row's totals cover everything the session drove.
  The root is resolved as the earliest session on a shared trace (the parent's turn calls the LLM before any child it spawns exists), independently of any session filter the caller applied, and always inside the caller's ownership scope; a session with no traced rows simply keeps its own id.
  It composes three independent filters — an optional lookback window (capped at 30 days), an optional exact session, and a row limit on the unaggregated per-call rows — plus an optional narrowing to a single owned agent.
  Omitting all filters means *all of the caller's agents, all time*.
- **Spend breakdown** — the whole earlier-estimates view in one read.
  Over an absolute half-open `[from, to)` instant range, it returns four rollups together: token/cost **per model**, spend **per agent** (sorted highest cost first, no top-N cap), spend **per day** for the spend-over-time chart, and spend **per session kind**.
  The range is instants rather than calendar fields on purpose: the client decides what a "month" means in its own timezone, and the server never reasons about calendars.
  It is a single procedure — rather than one per rollup — so **ownership resolves once per page load** (one owned-agent-list + scope check, not three) and the client renders the tab from a single loading/error state, never showing a stale total above an empty chart while a slower rollup is still in flight.
  It spans *all* of the caller's agents by default and narrows to **one owned agent** on request; narrowing goes through the same ownership resolution, so it can only ever shrink the scope.
  Under a narrowed read the per-agent rollup collapses to a single row restating the total — computed anyway rather than special-cased, since the single-procedure shape is the point.
  - The **per-agent** rollup groups on the trusted, gateway-stamped agent id — the same key every read scopes by.
    Spend an agent drove through an Invocation already rolls up under it **by construction**, not by a read-time join: an Invocation target's rows arrive already stamped with the root Driver's id (attribution decided at spawn time — see [observability — trusted attribution](observability.md#trusted-attribution)), so the grouping needs no special case and one row per real agent covers both direct and delegated spend.
    The display name of a **live** agent comes from the platform's own agent registry, never from telemetry — so a bucket whose self-reported name was polluted by delegated child rows (or renamed since) still shows the agent's real current name.
    Only a **since-deleted** agent falls back to telemetry: the latest `platform.agent.name` among its **own** rows in range — child (target) rows, marked by a `platform.invocation.id`, are excluded.
    A deleted Driver that made no direct calls in the window has no own-name to show and falls back client-side to its id.
    The name is display-only; the id remains the sole key and the sole authority for whose spend a row is.
    The rollup additionally guarantees an **Invocation target never appears as a spend row**: a bucket with **no live agent** whose telemetry name is a minted target name (recognized by the invocations context) can only be a pre-cutover target whose Driver is unrecoverable — its records predate the durable delegation record — so the row is excluded from the per-agent breakdown rather than shown under a throwaway identity; its spend still counts in the per-model and per-day rollups.
    The live-agent gate keeps the guard off real agents: a live agent a user happened to name like a target keeps its row.
    The attribution itself is a **cutover, not a migration**: rows written before the change keep their old attribution and are not backfilled.
  - The **per-session-kind** rollup answers *what started this work* — a person chatting, a Channel, a Schedule, a terminal.
    Telemetry cannot answer it alone: a call record names its Session but never what kind of Session that is, and the resource attributes that would carry it are stamped once per pod, while one pod serves Sessions of every kind at once.
    The rollup therefore joins per-Session cost against the session directory below.
    It reuses the same **trace-family root** the Overview's per-session rollup groups on, so a child harness run counts under the kind of the Session that spawned it rather than as a kind of its own.
    A Session the directory has no row for is **not dropped** — it is reported under an unattributed bucket, because the rollup sits beneath a total the user can read and silently shedding spend would make the two disagree.
    That bucket is load-bearing rather than defensive: it covers every agent that has not reported since the directory existed, and every deleted agent whose telemetry outlives its rows.
  - The **per-day** rollup takes one extra input the rest of the surface doesn't: an **IANA timezone** string the client supplies (its own `Intl` zone), because a "day" is a wall-clock calendar boundary and the server otherwise never reasons about calendars.
    The store groups each call into a local calendar day in that zone; the response is **sparse** — only days that actually carried spend appear, keyed `YYYY-MM-DD`.
    Generating the full month, zero-filling the gaps, and (for the current month) stopping at today are the client's job, the mirror of how the range leaves "what a month is" to the client.

The Overview session filter is **trace-aware**, not a literal session-id match: a queried session folds in every session that shares a trace with it, so a child harness run counts under "this session" even though it minted its own session id — the filter-side mirror of the per-session rollup's root grouping above.
Both folds ride the same trace-context propagation [observability](observability.md#agent-export) describes, and neither crosses the ownership boundary — every side of a fold carries the same owner scope.

## Provider budgets

A second answer to *how much have I spent* comes from the model provider itself, not from telemetry: a provider that keeps a budget for a credential — Bob Shell per team, the LiteLLM proxies per key — reports how much of it is used, its limit and its next reset.
The Providers page shows that beside the provider's key.
It is read live through the Connections context, which asks the provider with the stored credential on each read, the same way it asks whose account a Connection acts as.
Nothing is stored and nothing reaches the telemetry store.

The figure is the provider's, not the platform's, and the two are deliberately kept apart.
It covers everything the credential was used for, in or outside the platform, and comes in the provider's own unit (Bobcoins for Bob), so it is never summed with or reconciled against the Usage surfaces.
A provider that does not answer reads as *unavailable*, never as zero, for the same reason the disabled backend fails loud.
A key that may not read its own figures — a LiteLLM key without access to its key info — shows none, and so do providers that expose no budget to their credential at all, such as Anthropic and OpenAI.

## Agent-facing read

A second surface serves an agent rather than a signed-in user: three MCP tools, each **pinned server-side to the calling agent** — the agent names no id, so it can only ever read its own runs.
That pinning is the whole isolation model.
It rests on the gateway's identity, the same one that the spend ledger keys its rows by and that every telemetry read scopes by ([observability — trusted attribution](observability.md#trusted-attribution)), which an agent cannot forge, so no widening of the body shapes below can reach another agent's records or the platform's own.
The cost figures come from Metered Spend ([spend-limits](spend-limits.md#ledger)) and answer on every deployment; the per-call rows, the logs and the spans come from the telemetry store, and without it those parts answer `available=false`.

The surface is cut **by signal, not by question** — one read per thing the store holds, with the variation expressed as arguments.
An agent then asks its own questions of them rather than looking for the tool whose name matches its question, and a new question costs no new tool.

- **`get_metrics`** — the numbers.
  Window totals per unit and the per-model split, over whole UTC days (today and the days before it) or over the last given hours, with the measuring start beside them, and at coarser-to-finer **granularity** a row per session (its spend with the part of the sub-agents spawned from it, calls, model time, tokens, first/last day and first/last call time) or a row per LLM call from telemetry (model, request latency, tokens, context size), with the measured cost of its call row and whether that cost is estimated, joined by the Model Router's call id; a call with no router record, such as one on Bedrock, or with no call row has no cost.
  A window in hours sums the call rows ([spend-limits](spend-limits.md#ledger)); one that starts more than 30 days ago counts whole UTC days, and `totalsCover` says so.
  The per-session level is what turns *this got slower* into a comparison between runs; the summary level is the default because it is the cheapest and answers the commonest question.
  A further granularity gives a row per **sub-agent** — keyed by the id the spawn returned, with the models it ran, its spend, calls, model time and tokens — so a Driver can tell which piece of delegated work cost what and compare models or harnesses on cost.
- **`get_logs`** — every record the agent emitted, not only the LLM-call shape the spend reads narrow to, so errors and tool decisions are reachable.
  Content bodies are never exported ([observability — agent export](observability.md#agent-export)), so this is structural throughout; the read needs no redaction because there is nothing to redact.
- **`get_spans`** — the span structure of a run, read from the **trace** store rather than the log records.
  It is therefore the one agent-facing read not tied to one harness's log shape, and the only one that answers anything for a harness exporting traces alone.

Both bounds live in the contract package next to the tRPC input bounds, and one input shape serves all three reads: the **window** is 7 days by default and 30 at most, and a **page size** — 50 by default, 200 at most — caps every row list, so no single tool call widens into a whole-retention scan and an agent that omits either argument gets the cheap one.
Every capped list carries a **truncation flag**, because a short list and a complete one are otherwise indistinguishable and an agent reasoning about what it read would take the first for the second.
The flag is never inferred from the page being full — a list holding exactly the page size is not evidence that more exist — so each read establishes it against a count the page cannot fix.

The sub-agent rows need no scope of their own.
Each ledger row names its payer, the root Driver, and its calling agent, both from the gateway, so a root Driver's read holds exactly its own delegation tree, and the rows are that read grouped by calling agent.
A Driver can neither reach another Driver's sub-agents nor make its own appear elsewhere.
Each row is one sub-agent's own spend: a grandchild is a row of its own rather than folded into the sub-agent that spawned it, as on its delegation card.
The Driver's own calls have no row, so the totals stay the Driver's spend plus every sub-agent's — what the result says it covers.
A sub-agent reads the calls that it made itself, and its rows are the sub-agents below it.

The cost read alone reports **totals beside its rows**, and it states what they cover in the result rather than in a fixed sentence — because what they cover changes with the arguments.
Unnarrowed they span the window; narrowed they span the session and the sub-agents spawned from it; and at the coarsest granularity there are no rows to mistake them for.
Where rows are returned the result says outright that they are only the most recent and will not sum to the totals, which is what stops an agent reconciling the two and concluding one is wrong.

Every read also takes an optional **session**.
The cost figures narrow to the session that the gateway recorded for each call, with the sub-agents spawned from it; the telemetry reads resolve it through the same trace-aware fold the Overview uses, the session named plus any harness run it spawned.
The two differ only for a harness run that a session starts in its own shell, such as `claude -p`, which the gateway records with no session.

Spans carry no session id of their own, so a narrowed span read reaches the fold through the call records that do — the one place this read depends on the log shape it otherwise escapes, and a dependency that can fail, since a traces-only harness has no call records to resolve through.
The read therefore **reports an unresolved narrowing as unresolved** rather than returning an empty list: a session it cannot identify is not a session that ran nothing, and a quiet answer would read as the latter.
Whether the fold resolves is settled with a bounded existence check, and the fold itself stays inside the query — no list of trace ids is carried out of the store and back in, which would put an unbounded intermediate between the two.

The surface exists for the questions an agent has about itself — what a piece of work cost, where a run's time went, what failed — and for the owner-directed ones it answers on request.
The case-study edition deliberately carries no cost, so nothing consent-gated depends on any of it ([case-studies](case-studies.md)).

## Session directory

The kind of a Session — and whether it was a chat or a terminal — is **agent-owned state**: the agent-runtime records it beside the Session when it is created, and it lives on the agent's own volume ([persistence](persistence.md)).
That is the right home for it and a useless one for this subsystem, for two reasons that both bite exactly when the read matters.
A hibernated agent's volume is detached, so answering *what kind of Session was this* for a past month would mean waking every agent the user owns.
And an agent's volume is reclaimed when the agent is deleted, while its spend deliberately survives in telemetry — so the kind would vanish from windows whose cost still counts.

The directory is the narrowest fix for that: **one dimension per Session — its kind — copied into Postgres**, where it outlives both hibernation and deletion.
Everything else about a Session stays agent-owned; the directory is not a second Session store and nothing reads Sessions from it.

Agents push it rather than the platform pulling it, over the same authenticated agent→api-server channel [runtime delivery](runtime-delivery.md) uses: whenever its Session metadata changes, an agent reports the current set.
Three properties of that report follow from what it is for:

- **It is a snapshot, not a delta.** An agent that missed a report, restarted, or predates the directory converges on its next one; nothing has to be replayed, and a lost report costs latency rather than a permanent gap.
- **It is sent only when the answer changes.** Session metadata is touched on every turn (activity stamps), while a Session's kind is fixed at creation — so the agent compares what it would send against what it last sent and stays silent when they match.
  Without that, an ordinary conversation would put one write per turn on the api-server to re-assert a constant.
  Other changes wait a moment and go out together, but a new Session goes out at once, because the spend ledger checks a call's Session against the directory when the call's first record arrives.
- **Reporting is best-effort.** A failed report is logged and left for the next change or the next boot; nothing about serving the agent depends on it.
  The read path degrades to the unattributed bucket described above, which is exactly what a not-yet-reported agent looks like.

The directory is keyed by agent and Session, and every read of it is scoped to the caller's already-resolved owned-agent set — it widens nothing and is never a path to another user's Sessions.
The spend ledger reads it too: a call's Session counts only when the calling agent reported that Session here, and the spend by session type takes each Session's kind from it ([spend-limits](spend-limits.md#ledger)).

It is the one table in the platform that grows with **use** rather than with the number of things that exist, so it ages out on its own: a weekly job drops rows past a retention horizon, guarded by an advisory lock so one replica does the delete and the others no-op — the same shape [usage-tracking](usage-tracking.md#retention) uses for its activity log.
The horizon is deliberately several times the telemetry store's own retention rather than pinned to it.
Erring long costs a few stale rows nothing reads; erring short would drop the kind of a Session whose spend is still in range, which is the exact error the directory exists to prevent.

## Ownership scoping

Every read is scoped to the agents the caller owns; the scope is resolved **in the service layer**, above the store.
The service resolves the caller's owned agent IDs into an allowlist and hands only that allowlist to the reader, which does no scoping of its own — it filters unconditionally on the trusted owner attribute.
A caller can never widen the scope through input: naming an agent they do not own resolves to an empty allowlist, and an empty allowlist yields no rows rather than an error.
When a specific agent is requested, the same API-key binding check the rest of the agent-read surface applies is layered on top.

The owned set is the **union of the caller's live agents and the historical agent registry**, deliberately including deleted agents.
Spend history is a bill: it must not shrink retroactively when an agent is deleted.
Scoping only to live agents would erase a deleted agent's past spend from every window that overlaps its lifetime, so the registry keeps deleted agents in scope and their telemetry keeps counting for as long as the store retains it.

Which side of that union an agent came from is not discarded once the set is formed.
Resolution carries each agent's **live-or-registry-only** status forward — and, for a live agent, its current display name — past the allowlist and into the read, where the per-agent rollup depends on it twice: to label live agents from the platform rather than from telemetry, and to exclude a still-target-named bucket only when no live agent backs it (both above).
The reader itself still receives ids alone; liveness never reaches the store and never widens or narrows the scope, so it is purely a service-layer property of an already-resolved set.

## Telemetry reader

The reader is the only component in this subsystem that speaks to the telemetry store.
It holds a process-wide read connection and translates each contract read into an aggregate query against the store, always gated on the owner allowlist plus the request's window filters.

Its **spend** reads (the earlier-estimates rollups) and the agent-facing per-call rows take one log record per LLM call.
On a runtime with the Model Router ([harness configuration](harness-config.md#the-model-router)) the router writes that record for every call on every harness: the token counts read off the response, the provider Connection and alias, the upstream model id, the harness and the session, and no cost; Claude Code and Codex keep writing their own record beside it.
Router records from before the measuring start carried a cost, so the earlier estimates cover those days and show little after them.
The reader sums an agent from the router's records when it has any in the window, else from the harness's own (Claude Code's, Pi's of the same shape, and Codex's, which the collector reshapes to it ([observability](observability.md#agent-export))), so a router export that never reached the store leaves the harness's count and no call is summed twice.
The switch is per agent and invocation, at its own first router record, so an agent moved to a router image mid-window keeps the harness records from before, whenever the owner's other agents moved.
A Claude Code call on a native Connection (Bedrock) has no router record; Claude Code's own record names the model without the `claude/` prefix and is always counted, with no provider.
A call the router could not count is still a record: cut before its usage arrived, or answered without usage.
Each per-model and per-provider row carries its **uncounted** count beside its total, and the earlier-estimates view says so, so a total reads as a floor.
The **per-provider** rollup groups rows by the alias and Connection the router recorded, labelled with the Connection's live display name (a deleted Connection keeps its alias), with the harness's own records, which name no provider, in a row of their own.
Two agent-facing reads deliberately sit outside that shape: the emitted-record read drops the body predicate so an agent sees everything it emitted rather than only its LLM calls, and the span read goes to the **trace** store instead, which is why it is the one read that answers for a harness exporting traces alone.
Neither widens the ownership gate, which is the same attribute in both stores.
Where the reader does read the call records, it depends on a small, stable slice of their shape: the trusted **owner attribution** attribute (every query's ownership gate), the **session** and **trace** identifiers (session grouping and the trace-aware fold), the **model** name, the **timestamp** (windowing and first/last bounds), and the per-call counters it sums — the **token counters** (input, output, cache-read, cache-creation), the **cost counter**, which is carried in integer micro-dollars and scaled to dollars at read time, and the per-call **request latency**, whose sum is reported as model time.
Summed latency counts concurrent calls in parallel, so it measures model work rather than elapsed wall-clock.
The per-agent breakdown additionally reads the agent's **display name** attribute — never for scoping, only to label a row, and only as the **fallback for deleted agents** (live agents are labelled from the platform registry in the service layer) — taking the latest value seen in the window among the agent's **own** rows, excluding child rows carrying an **invocation identifier** (the target-own id the gateway stamps alongside the Driver's attribution), so a Driver keeps its own name rather than inheriting a target's throwaway one; a deleted agent still keeps a readable name, and an agent with no own-name row in the window is left unlabelled for the client to fall back to its id.
The per-day breakdown reuses the same **timestamp**, shifting each row into the client-supplied timezone before truncating to a calendar day so buckets line up with the user's wall clock rather than UTC.
This is a coupling to the harness's export contract, not to platform code; the exact attribute keys and query text are the reader's own detail in [`packages/api-server/`](../../packages/api-server/).
Where it narrows to those call records it does so by the record body alone — not by service name, which carries the agent's *template* name and would hide every template not literally named for the harness.
The two reads that do not narrow by body (emitted records, spans) still never widen past the owner gate, since that attribute is what scoping rests on in either store.

## Disabled backend

The telemetry store is optional (it ships with [observability](observability.md), disabled by default).
When no store endpoint is configured, the metrics service is wired to a **disabled** variant whose every read fails loud with a `PRECONDITION_FAILED` error rather than returning empty results.
Failing closed is deliberate: an empty success is indistinguishable from "no spend yet" and would silently misreport a bill as zero.
The Usage surfaces do not depend on the store: they read Metered Spend, and without a store the Settings Usage tab hides the link to the earlier estimates.
The earlier-estimates view treats that error as *metrics unavailable on this deployment* and shows an unavailable message, distinct from the empty-but-enabled state where a real store simply has no rows for the window.
Because the verdict is deployment-wide rather than per-window, it withdraws its month switcher instead of offering months that would fail identically.
The agent-facing read deliberately inverts this: it answers `available: false` with a reason, as a *success*, because its caller is unattended and needs to report "cost is not measured on this install" and carry on rather than treat a thrown error as a failed task.
Both variants are chosen once at composition time from the same configuration, so neither can be reached on an install of the other kind.

## Trust story

Attribution is trustworthy; the numbers are self-reported.
The two guarantees are different and this subsystem inherits both from the export path — see [observability — trusted attribution](observability.md#trusted-attribution) for the mechanism.

- **Counters are agent-reported.** Token and cost figures come from the agent's own telemetry: the Model Router's records are computed by platform code inside the agent's pod, and an agent runs untrusted code that can misreport them (inflate a token count, understate a cost, report a negative one, post records of its own to the rail).
  The read path does not attempt to independently verify them; it reports what was exported.
- **Attribution is gateway-stamped and unforgeable.** The agent attribution every query filters on is stamped by the agent's paired gateway, overwriting anything the agent set, and the collector drops any agent attribution the gateway did not stamp; the owner follows from the agent.
  So an agent can only ever pollute *its own* spend — never make its telemetry appear under another user, and never read another user's.
  The guarantee is **attribution, not content integrity**: whose spend is bounded exactly; how much is self-declared.
- **Metered Spend is a different number.** The agent's gateway measures every model call from the provider's reply, and the api-server prices it ([spend-limits](spend-limits.md)).
  The agent cannot change that number, so every spend figure on the screens, the limits and an agent's own cost report use it; the figures on this page stay agent-reported and serve only the earlier estimates, and the two need not agree.
- **Display identity is not attribution.** The agent's user-facing name travels in a separate, agent-exported attribute that exists only for finding an instance in the exploration UI.
  It is display-only and never used for scoping or ownership — the gateway-stamped id is the sole authority for whose data this is.
