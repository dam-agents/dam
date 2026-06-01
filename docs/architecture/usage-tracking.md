# Usage tracking

Last verified: 2026-05-22

## Motivated by

- [ADR-048 — Usage tracking: append-only activity log with pseudonymized identifiers](../adrs/048-usage-tracking.md) — Postgres-resident activity log, SQL views as the read interface, HMAC pseudonymization, inspector-role gating
- [ADR-015 — Multi-user authentication via Keycloak](../adrs/015-multi-user-auth.md) — `sub`, `realm_access.roles`, and `azp` are the identity primitives the activity log records
- [ADR-046 — Eliminate Instance, collapse into Agent](../adrs/046-eliminate-instance.md) — the K8s ↔ Postgres mirror is per Agent (formerly per Instance); event types and FKs use `agent_id`

## Overview

A **usage tracking** subsystem captures semantically-meaningful user activity in Postgres, shapes it into SQL views, and exposes those views to a dedicated inspector role through an HTML report and a JSON endpoint. It is operator-facing — daily-active users by surface, channel turns by Agent, schedule fires, OAuth connection lifecycle, file-import volumes — not product-analytics.

Three design choices follow from the operator framing:

- **Read interface is SQL views.** Adding a metric is a new view; consumers don't see the raw event table. The HTML report renders all "pilot" views; the JSON endpoint returns any one of them by name.
- **Storage is pseudonymized.** Every Keycloak `sub` written to Postgres is HMAC-SHA256 hashed with a per-install secret at the repository write boundary. Same input → same output, so cross-table joins and `GROUP BY sub` still work; reverse lookup requires the secret, which lives on the api-server pod. Pseudonymization, not anonymization — see [security-and-credentials](security-and-credentials.md) for the GDPR framing.
- **Access is a separate role.** The `platform-inspector` realm role gates `/api/usage/*`. It is independent of the platform-access role: "can read aggregates" doesn't imply "can use the platform." The Helm chart auto-creates the role and an `inspectors` group mapped to it; operators grant access by adding Keycloak users to the group.

The subsystem is the **api-server's** responsibility end-to-end. The controller does not participate; the agent-runtime does not participate. Writes happen in-process on the existing event bus; reads happen on a Keycloak-authenticated HTTP route mounted under the same Hono app.

## Diagram

```mermaid
flowchart LR
  user-auth[user authenticates]
  user-channel[Slack / Telegram user sends message]
  user-schedule[scheduled trigger fires]
  user-oauth[user connects / removes OAuth app]
  user-import[user imports a file bundle]

  agent-create[agent CM created / deleted]

  subgraph api-server[api-server]
    bus((event bus))
    psa[persist-activity saga]
    pas[persist-agents saga]
    boot[agent-bootstrap]
    retain[retention timer]
    pseudo[HMAC pseudonymizer]
    routes[/api/usage/* routes]
  end

  postgres[(Postgres)]

  inspector[inspector]

  user-auth --> bus
  user-channel --> bus
  user-schedule --> bus
  user-oauth --> bus
  user-import --> bus

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
```

## Bounded context

The subsystem owns:

- **`activity_events`** — append-only event log. One row per recorded interaction. Columns: `type`, `actor_sub` (HMACed), `agent_id`, `surface`, `outcome` (`success | failure` enum), `payload` (JSONB), `occurred_at`.
- **`actor_roles`** — role flags per pseudonymized sub. Records whether the user carried the configured "core" realm role at auth time. Read by the `usage_core_actor_subs` helper view to power the optional core-team exclusion filter.
- **`agents`** — Postgres mirror of agent ConfigMaps. Columns: `id`, `owner_sub` (HMACed), `created_at`, `deleted_at`. Lets SQL views resolve agent ownership without a K8s API round-trip.
- **`usage_*` SQL views** — the read API. View names form the public surface; the underlying tables are internal.

The subsystem reads from but does not own:

- **Other Postgres tables** (`pending_approvals`, `agent_skills`, `egress_rules`) — selected views project read-only summaries over them. Schema changes there can require view rewrites; view rewrites never require changes to the source tables. (Session-derived views were retired when sessions became agent-owned — see ADR-055.)

The subsystem produces no events of its own and exposes no domain operations to other modules — it is a sink for the event bus and a reader for SQL.

## Write path

The api-server emits domain events on every meaningful user interaction (auth, channel turn, schedule fire, OAuth connect/disconnect, file import) plus every agent lifecycle event (`AgentCreated` / `AgentDeleted`). These events already exist for the platform's own purposes; the usage subsystem only adds subscribers.

Two sagas subscribe to the bus:

- **persist-activity** — writes one `activity_events` row per `UserAuthenticated`, `ChannelTurnRelayed`, `ScheduleFired`, `ConnectionCreated`, `ConnectionRemoved`, or `FilesImported`. The auth subscriber also upserts `actor_roles` with the user's core-role flag.
- **persist-agents** — writes one `agents` row per `AgentCreated`, marks deleted on `AgentDeleted`. A startup bootstrap separately backfills the table from the K8s API for agents that pre-dated the saga.

Both sagas write through a repository layer that applies HMAC-SHA256 to every Keycloak `sub` immediately before INSERT — `actor_sub`, `owner_sub`, and `actor_roles.actor_sub` all go through the same pseudonymizer. The repository is the single chokepoint; emit sites and sagas continue to deal in raw subs in-memory.

Concurrency is bounded — each subscriber uses an RxJS `mergeMap` with a per-stream concurrency cap so a burst (api-server restart, silent-renew storm) cannot saturate the Postgres connection pool. The auth subscriber additionally exploits a partial unique index — one row per (sub, surface, day) — so heavy auth traffic does not bloat the table.

The persist-activity saga runs only when activity tracking is enabled at install time (a chart-level toggle, on by default); the persist-agents saga and the startup bootstrap run unconditionally because the `agents` table is also useful to consumers outside usage.

## Pseudonymization

Every Keycloak `sub` written to Postgres is replaced with `HMAC-SHA256(key, sub)` rendered as a 64-char hex string. The key — `ACTIVITY_HMAC_KEY` — is a per-install secret auto-generated by the Helm chart on first install and persisted across upgrades.

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

### Opening the report

For inspectors who have been granted the role:

1. Sign in to the platform UI as you normally would.
2. Open Chrome (or any Chromium-based browser) devtools — `Cmd+Option+I` on macOS, `Ctrl+Shift+I` on Windows / Linux, or right-click the page → **Inspect**.
3. Switch to the **Console** tab.
4. Type `platformUsage.openReport()` and press Enter. A new tab opens with the report.

The function returns a `Promise`, so the console prints `Promise {<pending>}` next to the call — that's expected. If the call returns a 403, the signed-in user does not carry the inspector role; if it returns a network error, the api-server is unreachable. Type `platformUsage` on its own to confirm the global is registered (`{openReport: ƒ}`).

## Retention

A weekly in-process timer in the api-server runs a bulk DELETE of rows in `activity_events` older than 180 days. Multi-replica installs race on `pg_try_advisory_lock` — only one api-server runs the DELETE per week, losers no-op. The timer starts 5 minutes after pod start so a rolling restart does not align every replica's tick.

Retention is independent of the activity-tracking toggle: if writes are disabled mid-deployment, the retention timer continues to age existing rows out.

## Core-team exclusion

Pilot metrics are intended for external users; the platform team's own traffic would distort the numbers. Two helper views capture the exclusion:

- `usage_core_actor_subs` — pseudonymized subs flagged with the configured core realm role (`actor_roles.is_core = true`).
- `usage_core_agents` — agent IDs whose owner is in the core set, computed by joining the `agents` mirror.

Every pilot view applies `AND actor_sub NOT IN (SELECT … FROM usage_core_actor_subs)` (or its `agent_id` / `owner_sub` analogue) so core-team traffic never reaches inspector-facing aggregates. The `is_core` flag is populated at auth time from the JWT's `realm_access.roles` — a user added to the core role only takes effect after their next login.

## Trust boundaries

- **Inspector role gates the read API.** Writes are unauthenticated to *the subsystem* — they originate inside the api-server process from already-authenticated user requests on other routes. The activity log inherits whatever trust boundary the originating route enforced.
- **HMAC key gates re-identification.** Holding the key (an in-cluster K8s Secret mounted into the api-server pod) is what lets a reader correlate a pseudonym back to a Keycloak `sub`. Database-only access does not.
- **Ad-hoc SQL is intentionally not exposed.** Earlier iterations included a `POST /api/usage/query` taking raw SQL. It was removed: an inspector with that endpoint can read other Postgres tables containing credential material (refresh tokens, HITL payloads). Inspectors get views; operators wanting psql go through `kubectl exec`.
