# Usage tracking

Last verified: 2026-08-31

## Overview

A **usage tracking** subsystem captures semantically-meaningful user activity in Postgres, shapes it into SQL views, and exposes those views to a dedicated inspector role through an HTML report and a JSON endpoint. It is operator-facing — daily-active users by surface, turns by Agent, schedule fires, connection lifecycle by provider, skill and artifact activity, file-import volumes, contribution-delivery health, which way in a new user chooses — not product-analytics.

Three design choices follow from the operator framing:

- **Read interface is SQL views.** Adding a report metric is a new view; inspectors don't see the raw event table. The HTML report renders all "pilot" views; the JSON endpoint returns any one of them by name. A separate passthrough surface serves external analytics — see [source passthrough views](#source-passthrough-views).
- **Storage is pseudonymized.** Every Keycloak `sub` written to Postgres is HMAC-SHA256 hashed with a per-install secret at the repository write boundary. Same input → same output, so cross-table joins and `GROUP BY sub` still work; reverse lookup requires the secret, which lives on the api-server pod. Pseudonymization, not anonymization — see [security-and-credentials](security-and-credentials.md) for the GDPR framing.
- **Access is a separate role.** The `platform-inspector` realm role gates `/api/usage/*`. It is independent of the platform-access role: "can read aggregates" doesn't imply "can use the platform." The Helm chart auto-creates the role and an `inspectors` group mapped to it; operators grant access by adding Keycloak users to the group.

The subsystem is the **api-server's** responsibility end-to-end. The controller does not participate; the agent-runtime does not participate. Writes happen in-process on the existing event bus, fed by other modules' events plus one inbound tRPC mutation the subsystem owns — `usage.entryPointChosen`, the browser reporting which way in the user picked; reads happen on a Keycloak-authenticated HTTP route mounted under the same Hono app.

## Diagram

```mermaid
flowchart LR
  user-auth[user authenticates]
  user-channel[Slack / Telegram user sends message]
  user-direct[user prompts or attaches a shell from the UI / CLI]
  user-schedule[scheduled trigger fires]
  user-oauth[user connects / removes a Connection]
  user-import[user imports a file bundle]
  user-entry[new user picks a way in]

  agent-create[agent CM created / deleted]

  subgraph api-server[api-server]
    bus((event bus))
    psa[persist-activity saga]
    pas[persist-agents saga]
    boot[agent-bootstrap]
    retain[retention job]
    pseudo[HMAC pseudonymizer]
    routes[/api/usage/* routes]
  end

  postgres[(Postgres)]

  inspector[inspector]
  analytics[analytics consumer]

  user-auth --> bus
  user-channel --> bus
  user-direct --> bus
  user-schedule --> bus
  user-oauth --> bus
  user-import --> bus
  user-entry --> bus

  agent-create --> bus
  boot -.startup K8s scan.-> postgres

  bus --> psa
  bus --> pas

  psa --> pseudo
  pas --> pseudo
  pseudo --> postgres

  retain --> postgres

  inspector -->|HTML / JSON / bearer token| routes
  routes -->|SELECT ... FROM usage_*| postgres
  analytics -->|usage_readers member, SELECT usage_src_*| postgres
```

## Bounded context

The subsystem owns:

- **`activity_events`** — append-only event log. One row per recorded interaction. Columns: `type`, `actor_sub` (HMACed), `agent_id`, `surface`, `outcome` (`success | failure` enum), `payload` (JSONB), `occurred_at`.
- **`actor_roles`** — role flags per pseudonymized sub. Records whether the user carried the configured "core" realm role at auth time. Read by the `usage_core_actor_subs` helper view to power the optional core-team exclusion filter.
- **`agents`** — Postgres mirror of agent ConfigMaps. Columns: `id`, `owner_sub` (HMACed), `created_at`, `deleted_at`. Lets SQL views resolve agent ownership without a K8s API round-trip.
- **`usage_*` SQL views** — the read API, in two surfaces: aggregate views backing the inspector report, and `usage_src_*` passthroughs forming the external-analytics surface (see [source passthrough views](#source-passthrough-views)). View names form the public surface; the underlying tables are internal.

The subsystem reads from but does not own:

- **Other Postgres tables** (`pending_approvals`, `agent_skills`, `skill_sources`, `egress_rules`) — selected views project read-only summaries over them. Schema changes there can require view rewrites; view rewrites never require changes to the source tables. (Session-derived views were retired when sessions became agent-owned.)

The subsystem is otherwise a sink for the event bus and a reader for SQL. It owns exactly one domain operation — a user reporting which way in they chose, which it turns into an event on that same bus — and everything else it stores arrives as another module's event.

## Write path

The api-server emits domain events on every meaningful user interaction (auth, channel turn, session turn, relay attach, schedule fire, connect/disconnect, file import), the contribution-delivery health transitions (apply failed / recovered / gave up), plus every agent lifecycle event (`AgentCreated` / `AgentDeleted`). Most already exist for the platform's own purposes and the usage subsystem only adds subscribers; the direct-path interactions below are the exception, recorded at the relay because nothing else had reason to notice them, as is the entry-point choice, which this subsystem emits from its own mutation.

Six properties of that stream are load-bearing for anyone reading the numbers:

- **A turn counts the same whichever way the user reached the agent.** Conversations arrive over two different transports — a Channel, or the relay the browser chat and the CLI share — and only the Channel side was ever recorded, so the platform's most-used surface produced no turns at all. Both now emit.

- **A session turn is counted when the prompt is sent, not when the reply lands.** Recording it on completion made the count depend on the transport surviving the whole turn, and the relay does not: a reconnect mid-turn dropped the socket, the turn was booked as a failure, and the reply arrived on a new socket that never saw the prompt and so counted as nothing. The bias fell entirely on long-running turns — the ones that matter most. Counting the send removes the dependency, and it is also the honest unit: what the user did is ask, and whether an answer came back is a question about the agent and its provider, not about platform usage. The cost is that abandonment is no longer visible; that was judged the cheaper loss, since an outcome skewed by network and provider failures would be read as product signal. The send is counted where the prompt is accepted from the client rather than where it is forwarded, so one abandoned during a cold start still counts — that window is exactly where a user waits longest.

- **Only prompts a person typed are counted.** The UI sends one itself: opening a Kinded Agent that has no sessions yet fires a hidden greeting, so counting every prompt frame would make a sandbox someone opened once and abandoned read as having held a conversation — and that is precisely the sandbox the number needs to expose. Machine-originated prompts therefore mark themselves on the wire and the relay skips them. An unmarked prompt still counts, so a client that does not know about the marker is over- rather than under-recorded: a missing turn is invisible, an extra one is at least explicable.

- **Connect events cover every authentication kind, not just OAuth.** A connection reaches its connected state either at creation or — for OAuth alone — when its authorization callback lands, so the event fires at whichever of those two points completes it. Emitting at both would double-count OAuth; emitting only at the callback (as it once did) left every non-OAuth connection invisible and could make disconnects outnumber connects.
- **A connection event names its provider, not just its grant.** A Connection's identifier is per-grant and its record is destroyed on disconnect, so the provider must ride the event or the answer to *which providers do people connect* dies with the Connection.
- **Some interactions leave no state behind, and those are the ones the event is load-bearing for.** A skill installed from a source is recoverable from the agent's own record; a Local Skill deliberately writes none, so the event is the only trace a user ever authored one. A share-link view is anonymous by construction and the artifact carries only a lifetime counter, so the event is what places those views in time. Where an event is the *sole* record, losing it loses the fact — which is the argument for recording an interaction even when its state is uninteresting.

Two sagas subscribe to the bus:

- **persist-activity** — one `activity_events` row per subscribed domain event, one subscriber per event type. It covers arriving (authentication), working with an agent (turns from either transport, shell attachment, scheduled fires, file imports, delegation to another agent), setting one up (connections, skills, harness configuration, agents created under a Kind), sharing what came out (library publishes, share-link views), and the account-level surfaces around all of it (experiment runs, feature flags, API keys) — plus the contribution-delivery health transitions. The per-event enumeration lives in [activity events](../activity-events.md) — which event is stored under which row type, and where each fires. That page is generated from the source and gated against drift, so it is a projection rather than a second copy to maintain; this page stays conceptual. The auth subscriber also upserts `actor_roles` with the user's core-role flag.

Where an interaction already leaves durable, timestamped state, the event is not redundant with it: **the state tables hold raw Keycloak subs and the activity log holds pseudonymized ones**. A table keyed by raw subs cannot be filtered against the pseudonymized core-team set, and cannot be shown to an inspector without exposing an identifier. Routing an interaction through an event is what puts it in the one space where it can be both joined and read safely — which is the reason to record something even when its state is already persisted.
- **persist-agents** — writes one `agents` row per `AgentCreated`, marks deleted on `AgentDeleted`. A startup bootstrap separately backfills the table from the K8s API for agents that pre-dated the saga.

Both sagas write through a repository layer that applies HMAC-SHA256 to every Keycloak `sub` immediately before INSERT — `actor_sub`, `owner_sub`, and `actor_roles.actor_sub` all go through the same pseudonymizer. The repository is the single chokepoint; emit sites and sagas continue to deal in raw subs in-memory.

Concurrency is bounded — each subscriber uses an RxJS `mergeMap` with a per-stream concurrency cap so a burst (api-server restart, silent-renew storm) cannot saturate the Postgres connection pool. Two subscribers additionally exploit a partial unique index and an `ON CONFLICT DO NOTHING` insert: auth keeps one row per (sub, surface, day) so heavy auth traffic does not bloat the table, and the entry-point choice keeps one row per sub so the first choice stands and a replayed call is discarded.

**One recorded interaction is an intent rather than a completed operation.** Every other event is a by-product of something the api-server did. The entry choice a new user makes on the empty home screen is a click that may lead nowhere — counting the users who choose a way in and then abandon it is the point of recording it — so the browser reports it through an owner-scoped procedure whose only effect is to emit the event. It names no Agent and carries no outcome of its own; from the write path down it is an ordinary row.

Both halves of an event are gated mechanically. A type in the registry is a promise that something raises it and something acts on it, and either half can go missing without breaking the build — an unsubscribed event still compiles and still fires, which from the emit site is indistinguishable from working instrumentation while the interaction reaches no table. A check wired into `mise run check` parses the api-server sources and fails when a registry entry has no emit site, or none that consumes it. It keys on emission, which goes through a single chokepoint, rather than on subscription, which has several legitimate forms — a saga spelling its subscription a new way would otherwise fail a correct build, and a gate that flags correct code teaches people to work around it. Where it cannot follow a reference, it reports rather than passes. It proves both ends exist, not that the consumer does anything useful; judging that stays with review.

What it does not cover is a module that never reaches the bus at all — the failure that produced these gaps. Nothing mechanical catches that without a hand-maintained list of modules, which is a list that goes stale and can be satisfied without collecting anything, so the gate is deliberately scoped to the invariant it can actually hold.

The persist-activity saga runs only when activity tracking is enabled at install time (a chart-level toggle, on by default); the persist-agents saga and the startup bootstrap run unconditionally because the `agents` table is also useful to consumers outside usage.

## Pseudonymization

Every actor identifier written to Postgres is replaced with `HMAC-SHA256(key, value)` rendered as a 64-char hex string. The key — `ACTIVITY_HMAC_KEY` — is a per-install secret auto-generated by the Helm chart on first install and persisted across upgrades.

That covers Keycloak `sub`s **and** the messenger-native id of an actor who has no platform identity at all — the Telegram user driving a relay. Both name a real person, so storing one in the clear beside a hashed one would spend the cost of pseudonymization without buying its protection. The messenger id keeps its own field rather than sharing the actor column, which stays Keycloak-`sub` space so cross-table joins remain sound. Real identity is deliberately retained on the other side of the split: the [logging](logging.md) audit trail records the raw value, because an investigation needs to know who, and that stream is governed at the log sink instead.

What this protects against:

- A database-only leak — backup exfiltration, replica compromise, a misconfigured read endpoint — yields opaque pseudonyms. Re-deriving identifiers requires the api-server pod or its mounted Secret.
- An inspector running views or ad-hoc analysis sees pseudonyms, not Keycloak subs. The inspector role can answer "how many users" without learning who they are.

What it does not protect against:

- An attacker with both the database **and** the api-server pod (or its Secret). Pseudonymization is GDPR Recital 26 risk reduction, not anonymization. The stored value remains personal data.
- Other surfaces that hold raw subs — K8s ConfigMap `owner` labels, OAuth-connection K8s Secret keys, `pending_approvals.owner_sub`, `identity_links.keycloak_sub`. Those are out of scope for this subsystem; activity log hardening is the first lever, not the only one.

Determinism is load-bearing — the same key applied across `activity_events.actor_sub`, `actor_roles.actor_sub`, and `agents.owner_sub` is what makes the views joinable. Rotating the key orphans every existing row; it is treated as permanent for the install.

## Read interface

Three Keycloak-gated endpoints, all behind the `platform-inspector` realm role:

| Endpoint | Returns | Audience |
|---|---|---|
| `GET /api/usage/views` | list of queryable view names | scripts, CLI scaffolding |
| `GET /api/usage?view=<name>` | one view's rows as JSON | programmatic consumers |
| `GET /api/usage/report` | full HTML page rendering the pilot view set | human inspectors |

The HTML report is rendered server-side as a single static page — no JavaScript, escaped, dark-mode aware. There is no visible UI affordance; the UI exposes a `window.platformUsage.openReport()` function registered at bootstrap that inspectors call from the browser devtools console. The function fetches with the Bearer token, wraps the response in a Blob URL, and opens it in a new tab (a plain `<a href>` cannot send the Bearer token); the Blob is revoked a minute after open.

When the inspector role is not configured at install time, the read endpoints are mounted as a no-op router. Activity writes continue independently — the read API is gated on inspector configuration, the writes on the activity-tracking toggle.

A `_7d` or `_30d` suffix in a view name is a contract about whole days: the window spans complete UTC days and closes at today's UTC midnight, so a 7-day view read on a Monday morning covers the previous Monday through Sunday. Today sits outside every window by design. A day still in progress placed beside finished ones reads as a fall in usage rather than as a bar not yet filled, and closing on a day boundary is also what makes a windowed view reproducible — read twice in the same day it answers the same question, and a past week can be re-derived. The cost is that the newest day takes up to 24 hours to surface; views with no suffix are unbounded and show it immediately.

### Source passthrough views

A second read surface serves an external usage-analytics pipeline, at the SQL layer rather than over HTTP: one `usage_src_*` passthrough view per table the subsystem reads, each enumerating exactly the columns allowed to leave that table. The views are the privacy boundary — columns holding raw Keycloak subs, and application payloads never written for analytics, are omitted; the activity payload flows through as an object, with each key audited: identity keys are pseudonymized at the write boundary, user-authored identifiers (skill names, source URLs) pass through as the exposed columns already do, and free-form prose (the driver error message) is stripped — and the column list is the contract: a column added to a base table stays invisible until the migration adding it recreates the passthrough, so table migrations are never blocked from outside. Aggregations live with the consumer, which reads nightly through a read-only Postgres login. Access is held by a **group role**, `usage_readers` — credential-less and login-less, created by the chart where the chart manages Postgres and by an operator where it does not. An operator grants that group membership to whichever login should read the metrics. Membership binds the login to the group rather than to any view, which is what makes it survive: privileges in Postgres attach to the object rather than the name, so recreating a view discards every grant on it, and a passthrough must be recreated rather than replaced whenever a column is renamed or reordered — exactly the migration that changes what a consumer reads. What the group holds is therefore a **reconciled state**, not the residue of past grants: the api-server re-grants SELECT on every passthrough it owns after running migrations, on each start. That is a reconcile rather than a step inside the migration because three unrelated things can break the invariant — a passthrough is added, a passthrough is recreated, or the group is created only after the views already exist — and the actors behind them (migrations, the chart, an operator) have no ordering relationship to each other. Reconciling is correct whatever order they ran in. Being a reconcile also sets what it will and will not respect: it grants and never revokes, so it cannot narrow access on its own, but it treats the passthrough set as authoritative, so a privilege removed by hand is drift and comes back on the next start. Withholding a passthrough from the consumer therefore means dropping the member or the view, not revoking a grant. Where the group does not exist it does nothing at all; where the state already matches it reads and grants nothing. It runs on every start either way, which is a handful of catalog queries. Because a privilege step living in application code is otherwise invisible in the release, it reports itself: every start logs which passthroughs the group can read — read back from the catalog after the fact rather than echoed from intent, and including whether the group can reach the database and schema at all, since a privilege it cannot use is not access. Anything it cannot make readable is warned about, under a name that separates what another start would fix from what needs an operator. Failure is reported the same way rather than raised: analytics access is optional and the platform starting is not, so a reconcile that cannot complete degrades instead of holding back the boot. The aggregate views are deliberately withheld from the group — a consumer able to read an aggregate would eventually key a metric on one, and renaming that aggregate would break it, which is the coupling this surface exists to remove. Withholding them leaves the passthrough column lists as the only contract. The group is inert until an operator adds a member, so an install that wants no analytics consumer has nothing to turn off. This is the database-level twin of the inspector role above — the platform offers read-only access over the usage views, and an operator decides who holds it; who that is stays outside the platform's knowledge. The passthroughs are deliberately outside the inspector surface: the `usage_*` aggregate views stay as the backing of the HTML report with no new features, while new metrics are authored consumer-side against the passthroughs.

### Opening the report

For inspectors who have been granted the role:

1. Sign in to the platform UI as you normally would.
2. Open Chrome (or any Chromium-based browser) devtools — `Cmd+Option+I` on macOS, `Ctrl+Shift+I` on Windows / Linux, or right-click the page → **Inspect**.
3. Switch to the **Console** tab.
4. Type `platformUsage.openReport()` and press Enter. A new tab opens with the report.

The function returns a `Promise`, so the console prints `Promise {<pending>}` next to the call — that's expected. If the call returns a 403, the signed-in user does not carry the inspector role; if it returns a network error, the api-server is unreachable. Type `platformUsage` on its own to confirm the global is registered (`{openReport: ƒ}`).

## Retention

A weekly retention job runs a bulk DELETE of rows in `activity_events` older than 180 days. It is one of the scheduled per-period jobs described on [platform-topology](platform-topology.md) — Redis-backed, one execution per period across the api-server replicas, each tick idempotent.

Retention registers only when activity tracking is enabled: an install with writes disabled ages nothing out, keeping whatever history existed when the toggle flipped.

## Core-team exclusion

Pilot metrics are intended for external users; the platform team's own traffic would distort the numbers. Two helper views capture the exclusion:

- `usage_core_actor_subs` — pseudonymized subs flagged with the configured core realm role (`actor_roles.is_core = true`).
- `usage_core_agents` — agent IDs whose owner is in the core set, computed by joining the `agents` mirror.

Every pilot view applies `AND actor_sub NOT IN (SELECT … FROM usage_core_actor_subs)` (or its `agent_id` / `owner_sub` analogue) so core-team traffic never reaches inspector-facing aggregates. The `is_core` flag is populated at auth time from the JWT's `realm_access.roles` — a user added to the core role only takes effect after their next login.

## Trust boundaries

- **Inspector role gates the read API.** Most writes are unauthenticated to *the subsystem* — they originate inside the api-server process from already-authenticated user requests on other routes, and the activity log inherits whatever trust boundary the originating route enforced.
- **One write route belongs to the subsystem.** `usage.entryPointChosen` is an owner-scoped tRPC mutation: the actor is the session's Keycloak `sub`, never a client-supplied field, and the input carries the choice alone. A caller can therefore only write about itself. Repeats are bounded by a partial unique index — one `entry_point_chosen` row per actor — so a client that replays the call cannot inflate the entry-point views.
- **Membership in a read-only group role gates the analytics surface.** The external consumer reads the `usage_src_*` passthroughs as a member of `usage_readers`, which holds SELECT on the passthroughs and nothing else — not the aggregate views, not the base tables — no HTTP path, no table or write grants, no credential of its own. Adding a member is an operator act the platform never sees; removing one is how access is withdrawn. The group role itself confers nothing until someone is added to it.
- **HMAC key gates re-identification.** Holding the key (an in-cluster K8s Secret mounted into the api-server pod) is what lets a reader correlate a pseudonym back to a Keycloak `sub`. Database-only access does not.
- **Ad-hoc SQL is intentionally not exposed.** Earlier iterations included a `POST /api/usage/query` taking raw SQL. It was removed: an inspector with that endpoint can read other Postgres tables containing credential material (refresh tokens, HITL payloads). Inspectors get views; operators wanting psql go through `kubectl exec`.
