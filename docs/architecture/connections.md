# Connections, Contributions, and the Runtime Channel

Last verified: 2026-06-16

## Overview

A Connection is everything an agent needs to talk to one external integration — credentials, hosts to reach, config files to author, MCP entries to expose, skills to install. Connection Templates are code-level catalog entries that ship defaults; granting a Connection to an Agent materializes its Contributions into the right destinations.

The subsystem cuts cleanly across three bounded contexts:

- **api-server — Connections context** owns Connection Templates, Connections, grants. Computes per-agent Contribution sets. Routes Contributions to the right rail per kind.
- **api-server — Runtime Delivery context** owns the outbox table, the events table, the delivery worker, the `runtime.applyState` call into agents, and the `runtime.hello` callback from agents.
- **agent-runtime — Runtime Channel context** receives `applyState`, dispatches Contributions to per-kind drivers, processes events in order through per-kind event handlers, reconciles on-disk state to match the snapshot, calls back to `hello` on boot.

A grant of one Connection produces Contributions of several kinds. They don't all travel the same rail:

```mermaid
flowchart LR
  grant[Connection grant on Agent A]
  hostRail[egress-allow / egress-inject Contributions]
  rtRail[env / file / mcp-entry / skill-ref Contributions]
  envoy[egress_rules then Envoy ext_authz]
  channel[runtime channel]

  grant --> hostRail
  grant --> rtRail
  hostRail -->|sync rows| envoy
  rtRail -->|outbox row| channel
```

There are two rails. `egress-allow` and `egress-inject` Contributions sync into Postgres `egress_rules` and are read live by Envoy; `egress-inject` additionally carries a credential the gateway injects on the wire (mechanics in [security and credentials](security-and-credentials.md)). Everything else — `env` (formerly a controller-render/pod-roll rail; moving it onto the runtime channel means a grant change no longer rolls the agent pod), `file`, `mcp-entry`, `skill-ref` — travels the runtime channel and is what the rest of this page is about.

The runtime channel is two routes between api-server and agent-runtime:

```mermaid
flowchart LR
  outbox[(outbox + events tables)]
  worker[delivery worker]
  rt[agent-runtime]
  drivers[per-kind contribution drivers]
  handlers[per-kind event handlers]
  api[harness API]

  outbox --> worker
  worker -->|applyState| rt
  rt --> drivers
  rt --> handlers
  rt -->|hello| api
```

The wire payload carries:

- **`version`** (top-level) — per-agent monotonic counter, the single ack cursor for the payload. Bumped on any contribution edit or event insert.
- **`state`** — the agent's full desired configuration (Contributions). Reconciled by diff. `hash` short-circuits no-op pushes.
- **`events`** — ordered one-shot directives the agent must execute (schedule triggers, schedule resets, workspace seeding). Processed in order through per-kind handlers inside the agent-runtime.

State changes write to the outbox, the worker reads and dispatches a fresh payload, the agent receives state + events and reconciles contributions + invokes event handlers, and the agent calls back on boot/wake to catch up.

## Concepts

### Connection Template

A code-level catalog entry. Premade templates (GitHub, Anthropic, Spotify, Linear MCP, …) ship with full defaults — auth flow, hosts, scopes, recommended contributions. Custom templates (Custom MCP, Custom OAuth, Custom Header) ship the *shape* but leave the integration's identity for the user to fill in.

Two display-axis attributes drive UI grouping:

| `category` | `isCustom` | Where the user encounters it |
|---|---|---|
| `app` | `false` | Apps section: GitHub, Spotify, Anthropic, OpenAI, Google services, GitHub Enterprise, … |
| `mcp` | `false` | MCP servers section: Linear MCP, Atlassian MCP, … (as added) |
| `mcp` | `true` | Custom Connection → "Add MCP server" |
| `other` | `true` | Custom Connection → "Add OAuth credential" / "Add Header credential" |

Templates are registered in code; adding a new integration is one entry. Schemas validate user input; the template's `build()` function projects inputs into the concrete `auth` + `contributions[]` of the Connection record.

Beyond the auth credential, a template may declare optional **config inputs** — e.g. Bob's model and tenant pins — that the user fills at connect time; each filled input projects into an additional `env` contribution, validated against the input's spec.

#### Internal-only templates

Some templates (initially Spotify, Slack, YouTube, and all Google services) are hidden from regular users client-side, affecting only what's offered (on both the Connections settings page and the sandbox creation wizard), not Connections already created. Testers reveal the full catalog by running `platformConnections.showInternal()` in the browser devtools console, or by tapping the version string on the settings page five times.

### Connection

A uniform shape — every Connection looks the same regardless of category or auth mode:

```ts
interface Connection {
  id: string;
  ownerId: string;            // K8s sub
  templateId: string;         // which Template this was built from
  name: string;               // user-visible label
  inputs: Record<string, unknown>;   // raw user-typed values, for re-render
  auth: AuthConfig;
  contributions: Contribution[];
}
```

The `auth` field carries credential-acquisition state in one of three modes: **OAuth** (a client identity, references to the stored refresh and access tokens, and granted scopes), **header** (a reference to the stored secret plus the header name and value format to inject), or **none**. Token references point at the per-Connection K8s Secret — never inline secret material. Auth is kept separate from contributions because credentials have their own acquisition and refresh lifecycle. Exact field shapes live in the [Connections contract types](../../packages/api-server-api/src/modules/connections/).

### Contribution

A typed unit a Connection emits when granted to an Agent — a discriminated union over `kind`. The kinds today:

- **`env`** — an environment variable the harness merges in at spawn, carrying a credential placeholder rather than the secret itself.
- **`egress-allow`** — permission to reach a host (optionally path-scoped).
- **`egress-inject`** — an allowed host plus a credential the gateway injects on the wire, as a header or a query parameter.
- **`file`** — a config file to author, with a format and a merge mode (see [Built-in contribution impls](#built-in-contribution-impls)).
- **`mcp-entry`** — an MCP server to expose to the harness.
- **`skill-ref`** — a skill source to install at a pinned version.

Kinds are added by extending the union and gating on agent capabilities (see [Versioning](#versioning)). Exact per-kind fields live in the [Connections contract types](../../packages/api-server-api/src/modules/connections/).

### Event

A one-shot directive the agent executes through a per-kind handler inside the agent-runtime. Each event carries an `id` (stable across redeliveries — the dedupe key), a `kind`, a kind-specific `payload`, the agent-monotonic `version` slot it occupies, and an `expiresAt` ttl. The kinds today are **trigger** (fire a scheduled task, optionally continuing or starting fresh), **schedule-reset** (clear a schedule's state), and **workspace-seed** (clone a repo into the workspace). Exact payload shapes live in the [runtime contract types](../../packages/agent-runtime-api/src/modules/runtime/).

The `id` is the dedupe key. Redelivery is caught agent-side: the event loop settles without re-firing when the event's `version` is already covered by the applied cursor or its dedupe key already ran at the same or a later fire timestamp (tracked in the agent's local state store), and locally expires anything past its ttl.

All event kinds are built-in to every agent: the agent advertises the full set on `hello`, single-sourced from the schema enum. Contribution kinds, by contrast, are gated by what the manifest's drivers declare — so capability filtering applies to contributions, not events.

## Example Connections

### App preset: GitHub Enterprise

```jsonc
{
  "id": "conn-7a8b",
  "templateId": "github-enterprise",
  "name": "GHE (ghe.acme.com)",
  "inputs": { "host": "ghe.acme.com", "clientId": "…", "clientSecret": "…" },
  "auth": {
    "kind": "oauth",
    "clientId": "Iv1.…",
    "refreshTokenRef": { "secretName": "platform-secret-conn-7a8b", "key": "refresh_token" },
    "accessTokenRef":  { "secretName": "platform-secret-conn-7a8b", "key": "access_token" },
    "scopes": ["repo", "read:user", "user:email"]
  },
  "contributions": [
    { "kind": "egress-allow", "host": "ghe.acme.com" },
    { "kind": "env",          "name": "GH_TOKEN", "placeholder": "dummy-placeholder" },
    { "kind": "env",          "name": "GH_HOST",  "placeholder": "ghe.acme.com" },
    { "kind": "file",
      "path": "$HOME/.config/gh/hosts.yml",
      "format": "yaml",
      "mergeMode": "key-targeted",
      "content": { "ghe.acme.com": { "oauth_token": "dummy-placeholder", "git_protocol": "https" } } }
  ]
}
```

### Custom MCP server

```jsonc
{
  "id": "conn-1d2e",
  "templateId": "custom-mcp",
  "name": "Acme internal MCP",
  "inputs": { "url": "https://mcp.acme.internal/sse", "authMode": "oauth" },
  "auth": { "kind": "oauth", "clientId": "…", "scopes": [], "…": "…" },
  "contributions": [
    { "kind": "egress-allow", "host": "mcp.acme.internal" },
    { "kind": "mcp-entry",    "name": "acme",
      "url": "https://mcp.acme.internal/sse",
      "headers": { "Authorization": "Bearer dummy-placeholder" } }
  ]
}
```

### Custom Header credential

```jsonc
{
  "id": "conn-3f4a",
  "templateId": "custom-header",
  "name": "Internal billing API",
  "inputs": { "host": "billing.acme.internal", "headerName": "X-API-Key", "value": "…" },
  "auth": {
    "kind": "header",
    "valueRef":   { "secretName": "platform-secret-conn-3f4a", "key": "value" },
    "headerName": "X-API-Key",
    "valueFormat": "{value}"
  },
  "contributions": [
    { "kind": "egress-inject", "host": "billing.acme.internal",
      "headerName": "X-API-Key", "valueFormat": "{value}" }
  ]
}
```

## Contribution fan-out

The api-server's contribution-fanout layer routes each Contribution kind to the rail that delivers it. Different rails because the kinds have genuinely different delivery semantics:

| Kind | Rail | Delivery semantics | Note |
|---|---|---|---|
| `env` | Runtime channel `applyState` (state slice) | Sub-second push; applied at next harness spawn | Written to a JSON file on the PV; the harness spawn path merges it into the process env (user env wins). A change recycles the harness at an idle turn boundary — no pod roll. |
| `egress-allow` | Postgres `egress_rules` → Envoy `ext_authz` | Live read; no pod involvement | Joined per-grant; revoke sweeps rows. Agent never sees these. |
| `egress-inject` | Postgres `egress_rules` → Envoy `ext_authz`, plus a wire-injected credential at the gateway | Live read; no pod involvement | Same `egress_rules` row as `egress-allow`; the gateway also injects `headerName`/`valueFormat` on the wire (mechanics in [security and credentials](security-and-credentials.md)). Agent never sees these. |
| `file` | Runtime channel `applyState` (state slice) | Sub-second push; idempotent reconciliation | Per-format + per-mergeMode driver materializes. |
| `mcp-entry` | Runtime channel `applyState` (state slice) | Sub-second push; idempotent reconciliation | Driver dispatches to harness-specific path. |
| `skill-ref` | Runtime channel `applyState` (state slice) | Sub-second push; per-version installer | Driver wraps existing skill-fetch helpers. |

The rail choice is a property of the kind, not of the Connection. A single grant of GitHub Enterprise produces Contributions on both rails: `egress-allow` (egress_rules → Envoy live), and `env` + `file` (runtime channel push). They flow independently.

## The runtime channel

Two tRPC routes, prefixed by protocol-major version (`runtime.v1.*`). Adding a new contribution kind, event kind, or optional payload field stays on `v1` — capability flags carry the gate; new majors only on semantic break.

```mermaid
sequenceDiagram
  autonumber
  participant USER as user (UI)
  participant AS as api-server
  participant PG as Postgres
  participant BQ as BullMQ
  participant WK as worker handler
  participant RT as agent-runtime

  USER->>AS: grant Connection X to Agent A
  AS->>PG: BEGIN, write grant, bump version, upsert outbox row, COMMIT
  AS->>BQ: enqueue job state:A
  AS-->>USER: 200

  BQ->>WK: dispatch job
  WK->>PG: read outbox row, check agent state
  Note over WK: exit clean if Agent A not running, sweep retries later
  WK->>PG: compute state slice and pending events for A
  WK->>RT: runtime.v1.applyState (version, state, events)
  RT->>RT: reconcile contributions per kind
  loop per event in order
    RT->>RT: per-kind handler — does the work, dedup via local state store
  end
  RT-->>WK: apply outcome (cursor, settled events, failures)
  WK->>PG: UPDATE outbox last_applied and stamp events dispatched_at up to applied cursor
```

### `applyState` — state and events delivery (server → agent)

The server sends a per-agent monotonic `version` cursor, the **full desired state** (the post-capability-filter Contribution snapshot plus a deterministic hash that short-circuits no-op pushes), and the **currently pending events** in order. The agent reconciles contributions per kind by diff and processes events in order through per-kind handlers in the agent-runtime.

The reply is a discriminated outcome, not a bare ack:

- **applied** — the payload was processed. It returns the applied cursor, the resulting state hash (null until the first clean settle), the set of events that settled, and **any per-driver failures**. A failure leaves that driver's slice unsettled for redelivery without blocking the rest of the payload.
- **stale** — the agent's contributions were already at or beyond the requested version, so state reconciliation was skipped; the agent still applies any events it hasn't seen and reports which settled.

Concurrent dispatches from different replicas race naturally: the agent rejects versions older than its applied cursor (last-version-wins), which is what surfaces as the *stale* outcome. The applied hash is recorded on the agent's outbox row for the periodic sweep to compare against. Exact reply shape lives in the [runtime contract types](../../packages/agent-runtime-api/src/modules/runtime/).

### `hello` — agent → api-server catch-up

Called on boot, on wake from hibernation, and on any agent-side reconnect. It never carries state itself — if the reported cursor is behind, it enqueues a worker dispatch and the catch-up arrives as an ordinary `applyState`.

```ts
runtime.v1.hello({
  lastAppliedVersion?: number;
  lastAppliedHash?: string;
  protocolVersion: "v1";
  agentRuntimeVersion: string;
  capabilities: { contributions: ContributionKind[]; events: EventKind[] };
}) => {
  events: Event[];
}
```

The returned `events` array is always empty today — catch-up state and events arrive via the worker's `applyState`, never inline.

```mermaid
sequenceDiagram
  autonumber
  participant RT as agent-runtime on boot
  participant HS as harness-API-server
  participant PG as Postgres

  RT->>HS: runtime.v1.hello (lastAppliedVersion, lastAppliedHash, capabilities)
  HS->>PG: compare reported cursor with outbox version
  HS->>HS: enqueue worker dispatch if behind
  HS-->>RT: events: []
  HS->>RT: applyState (state + pending events, via the worker)
  RT->>RT: reconcile contributions, run per-kind event handlers
```

`hello` is read-only with respect to the outbox — the worker dispatch it enqueues is what stamps `dispatched_at`. Events never travel inside the `hello` response; they ride the `applyState` that follows.

### Per-kind event handlers (agent-side)

Each event kind has a built-in handler inside the agent-runtime's event loop. The kind selects the handler; the payload shape and the side effect are kind-specific. The common contract:

- The handler receives the event's `payload`; the loop owns `id`-based dedupe before the handler is ever invoked (applied-version cursor plus a per-key last-run timestamp in the agent's local state store).
- It does the work (e.g. open an in-process ACP session for `trigger`, clone the seed repo for `workspace-seed`); it does NOT touch `runtime_events`.
- A handler failure leaves the event unsettled, so it is redelivered on the next dispatch until it succeeds or expires.

The worker is the only writer to `runtime_events.dispatched_at` (it stamps in the apply-ack transaction). Splitting responsibilities this way means a new event kind adds an agent-side handler and doesn't have to know about the outbox at all.

## Event lifecycle

Idempotency lives in two places: the work-doing handler's uniqueness constraint (prevents double side effect) and the worker's cursor stamp (prevents redelivery once the agent acknowledged).

```mermaid
sequenceDiagram
  autonumber
  participant SCH as schedule firer
  participant PG as Postgres
  participant WK as worker
  participant RT as agent-runtime

  SCH->>PG: BEGIN, bump agent.version to V, INSERT runtime_events (id, agentId, kind, payload, version=V, expiresAt), upsert outbox row, COMMIT
  PG->>WK: BullMQ wakes — worker reads outbox and non-dispatched events
  WK->>RT: applyState (version=V, state, events=[E1])
  RT->>RT: reconcile contributions
  RT->>RT: per-kind handler for E1.kind — does the work, records E1's run in the local state store
  RT-->>WK: appliedVersion=V, appliedHash
  WK->>PG: UPDATE runtime_events SET dispatched_at = now() where version up to V AND dispatched_at IS NULL
  Note over WK: Next dispatch state-builder excludes E1
```

### Crash between dispatch and ack

If the agent runs the handler but crashes before sending the apply response, the worker doesn't get an `appliedVersion` — no rows are stamped. The event reappears in the next snapshot; the agent's event loop consults its local state store (applied cursor plus per-key last-run timestamp, persisted on the PVC) and settles the already-run event without re-firing; the next ack stamps `dispatched_at`.

If the handler ran but the apply response is lost, same path — redelivery settles from the state store and the cursor advances. Re-fire is possible only if the crash lands between the side effect and the state-store write.

If the handler succeeds and the agent acks but then crashes before doing anything else, that's fine — events are already marked dispatched.

### Server-side `dispatched_at` stamping

Owned by the worker, set in the apply-ack transaction using the cursor. The per-kind handler does not touch the outbox — its job is the side effect; dedupe bookkeeping lives in the agent's local state store.

### Expiry

Each event row carries `expires_at`. The state-builder filters `expires_at > now() AND dispatched_at IS NULL`. The cron sweep deletes rows past expiry that were never dispatched, counted as `dropped-expired`. The agent applies the same TTL check on incoming events as defense in depth.

## Outbox + events

One outbox surface in Postgres, plus the events table that feeds the payload:

| Table | Shape | Why |
|---|---|---|
| `runtime_state_outbox` | One row per agent | Delivery is per-agent and last-write-wins. Coalesce-by-agent. Carries `version`, `last_enqueued_at`, `last_applied_version`, `last_applied_hash`, `last_applied_at`. |
| `runtime_events` | One row per pending event | Each carries its own `version` (the slot in the agent's monotonic sequence), `expires_at`, and `dispatched_at`. The state-builder reads non-dispatched, non-expired rows when constructing `events[]`. |

### Mutation transaction

Every state-affecting handler commits the domain mutation, bumps the agent's version, and upserts the outbox row atomically, then enqueues a BullMQ job:

```ts
await db.transaction(async (tx) => {
  const v = await tx.bumpAgentVersion(agentId);
  await tx.connections.grant(agentId, connectionId);
  await tx.runtime_state_outbox.upsert({ agentId, version: v, lastEnqueuedAt: now() });
});
await stateQueue.add(
  "state",
  { agentId },
  { jobId: `state:${agentId}` },   // stable id → natural coalescing
);
return ok();   // user-facing response returns immediately
```

For a schedule firing:

```ts
await db.transaction(async (tx) => {
  const v = await tx.bumpAgentVersion(agentId);
  await tx.runtime_events.insert({
    id, agentId, kind: "trigger", payload: { scheduleId, task, … }, version: v, expiresAt,
  });
  await tx.runtime_state_outbox.upsert({ agentId, version: v, lastEnqueuedAt: now() });
});
await stateQueue.add("state", { agentId }, { jobId: `state:${agentId}` });
```

The user-facing response does not depend on agent reachability. If BullMQ's enqueue fails or Redis drops the pending job, the cron sweep re-enqueues the row.

### Worker

A BullMQ Worker on every api-server replica consumes from the single `state` queue. BullMQ owns the dispatch loop, retry-with-backoff, stalled-job recovery, and the dashboard surface; the platform code is the *handler*:

```mermaid
flowchart TD
  handlerStart([handler invoked])
  load[load outbox row by agentId]
  exists{row exists?}
  noop[exit clean, return]
  check{agent running?}
  defer[exit clean, sweep re-enqueues later]
  retry[throw, fast-retry on backoff]
  compute[compute state slice + non-dispatched events]
  dispatch[POST runtime.v1.applyState]
  stamp["UPDATE outbox last_applied and stamp events dispatched_at up to acked"]
  ok[return]
  fail[throw, BullMQ retries]

  handlerStart --> load --> exists
  exists -->|no| noop
  exists -->|yes| check
  check -->|"no (plain)"| defer
  check -->|"no (hello-triggered)"| retry
  check -->|yes| compute --> dispatch
  dispatch -->|apply outcome| stamp --> ok
  dispatch -->|error| fail
```

BullMQ retries cover transport failures (network blip, agent crash mid-call) and the boot window: a `hello`-triggered dispatch whose agent is a heartbeat short of Ready throws to fast-retry on the backoff, so fresh config lands in ~a second instead of waiting a full sweep tick. A plain dispatch to an agent that isn't running exits clean — the cron sweep re-enqueues on its next tick, and `hello` picks up the payload when the agent eventually wakes.

### Cron sweep

A scheduled job runs every minute and does two things:

1. **Outbox staleness check.** Scan rows where `last_enqueued_at > last_applied_at AND last_enqueued_at < now() - sweepInterval`. For each, re-enqueue with the row's stable id. This is the load-bearing path for surviving any BullMQ / Redis loss: rows in Postgres are the truth.
2. **Expired-event drop.** Delete `runtime_events` rows where `expires_at <= now() AND dispatched_at IS NULL`; emit `dropped-expired` count.

### Agent-state cache

The worker handler reads agent running-state from an in-memory cache fed by the existing ConfigMap watch in the agents service — never from a direct K8s API call. When the agent is not running a plain dispatch exits clean and the outbox row waits for the cron sweep to re-enqueue once it transitions back to running. A `hello`-triggered dispatch instead fast-retries on the queue backoff: `hello` means the agent is up and Ready is imminent, so the brief miss resolves in ~a second rather than at the next sweep tick.

### Redis-down behavior

Redis is the signal path; BullMQ stores job state in Redis with relaxed durability. A Redis outage may drop pending jobs; in-flight handlers see Redis errors and fail. The cron sweep is the recovery path: any outbox row whose enqueue was lost gets re-enqueued on the next sweep tick. Delivery latency degrades from sub-second to ≤ sweep-interval; no events are lost because the outbox + events tables are in Postgres.

## Agent-side: drivers, manifest, event handlers

### The manifest

Every agent image ships a `runtime-manifest.yaml` declaring which impl handles each Contribution kind, plus any custom impls registered by harness-specific code. The kinds advertised on `hello` are derived from this (contribution kinds from the driver keys; event kinds are the built-in set), not declared separately. Validated against a versioned schema at agent-runtime boot — fail-fast on malformed manifest.

```yaml
# packages/agents/example-agent/runtime-manifest.yaml
manifestVersion: 1

drivers:
  mcp-entry:
    impl: file                                # built-in
    path: "$HOME/.claude/.mcp.json"
    format: json
    mergeMode: key-targeted
    keyPath: "mcpServers"
  skill-ref:
    impl: skill-install                       # built-in
    paths: ["$HOME/.claude/skills"]
  file:
    impl: file                                # built-in; per-Contribution params on the wire
```

A harness that needs custom code declares it explicitly in the manifest under `extensions.impls`:

```yaml
# packages/agents/codex-agent/runtime-manifest.yaml
manifestVersion: 1

drivers:
  mcp-entry:
    impl: codex-mcp-with-sighup               # custom (must be declared below)
    path: "$HOME/.codex/mcp.json"

extensions:
  impls:
    - name: codex-mcp-with-sighup
      module: "/usr/local/share/dam-runtime/codex-overrides.mjs"
      export: "codexMcpReloadImpl"
```

The manifest declares only `drivers` and optional `extensions`; there is no `capabilities` block. The kinds an agent advertises on `hello` are derived at runtime — contribution kinds from the `drivers` keys, event kinds from the built-in set (every agent supports all event kinds).

Custom contribution impl names may not collide with built-in names (`file`, `skill-install`, …) — registration rejects collision; runtime-channel boot fails loud. Event handlers are built-in per kind and not user-pluggable.

### Built-in contribution impls

| Impl | Used by | Behavior |
|---|---|---|
| `file` | `file` kind directly, and `mcp-entry` via composition | Format (`yaml`/`json`/`text`/`ini`) × MergeMode (`overwrite`/`section-marker`/`key-targeted`/`yaml-fill-if-missing`). The matrix is the substrate for all file-shaped writes. |
| `skill-install` | `skill-ref` kind | Wraps the existing skill-fetch helpers; resolves source URL, fetches at version through the gateway, materializes into configured skill paths, removes vanished skills on snapshot reconciliation. |

### Driver reconciliation

`applyState` delivers the full Contribution snapshot. The driver dispatcher groups contributions by kind and calls each driver's `apply(contributions, ctx)`:

1. Driver compares the desired set with what's on disk (or in its own per-kind state file on the agent PVC).
2. Adds new contributions, updates changed ones, removes anything no longer in the snapshot.
3. Returns per-driver outcome.

Removal semantics depend on the kind and merge mode. For `file` contributions: `overwrite` and `section-marker` and `key-targeted` modes remove cleanly; `yaml-fill-if-missing` is the legacy carve-out — additive only, removal leaves stale entries until the user edits the file. New file producers must pick a remove-safe mode.

### Event handler loop

After contribution reconciliation, the agent processes events in order:

```
for each event E in payload.events:
  if E.version <= lastAppliedVersion or E's dedupe key ran at >= E's fire ts:
    settle and continue
  if E.expiresAt <= now():         # defense in depth — server may have raced
    settle and continue
  invoke per-kind handler with E.payload
  record E's dedupe key + fire ts in the state store
```

Settled event ids ride back on the apply response, and the worker stamps `dispatched_at` from the ack cursor. The "have I run this?" state is the agent's own: the local state store records the applied cursor and per-key last-run timestamps, so a redelivered event settles without re-firing.

## Versioning

| Version | Where it lives | Bumps on |
|---|---|---|
| **`protocolVersion`** | hello payload + route prefix | Wire-incompatible break (field removed, semantic changed). Routes coexist for one release; agents on the old major continue to function via their existing route prefix. |
| **`manifestVersion`** | top of `runtime-manifest.yaml` | Manifest schema break. Independent of protocolVersion. |
| **`agentRuntimeVersion`** | hello payload | Image build identity. Diagnostic only — never used for routing. |
| **`version`** (per-agent) | applyState payload (top-level), outbox row, event row | Monotonic per agent; bumped on every contribution edit or event insert. The single ack cursor. |

### Forward-compat is the supported direction

Older agent on newer server is the common case. The server keeps every `runtime.v1.*` route operational across an additive minor change; the server's outbound payloads include only fields the agent's protocolVersion defines plus optional additions (agent parses leniently, ignores unknown fields).

Newer agent on older server is rare (images are pinned). The agent calls `runtime.v1.hello`; on 404 (server doesn't speak v1 anymore), the agent fails loud rather than silently degrading.

### Capability negotiation

The agent's `hello` declares which Contribution kinds and which Event kinds it supports. The api-server filters outbound payloads: unsupported items are dropped at send time (logged + counted with a `dropped-unsupported` metric).

The UI surfaces the gap at grant time: connecting GitHub to a Claude-Code agent that doesn't support `skill-ref` shows "Agent doesn't support skills; this connection grants envs + hosts but not skill installation."

## Persistence touchpoints

| Substrate | What lives there | Notes |
|---|---|---|
| Postgres `connections` | Connection records (template id, auth, contributions[], inputs, owner) | New table for the unified model. |
| Postgres `runtime_state_outbox` | One row per agent | `agent_id`, `version`, `last_enqueued_at`, `last_applied_version`, `last_applied_hash`, `last_applied_at`. |
| Postgres `runtime_events` | One row per pending event | `id`, `agent_id`, `kind`, `payload`, `version`, `created_at`, `expires_at`, `dispatched_at`. Read by the state-builder; stamped by the worker in the apply-ack transaction. |
| Runtime-state file on the agent PVC | Applied cursor (`lastAppliedVersion`, `lastAppliedHash`) and per-key event last-run timestamps | The agent-side dedupe state for event redelivery. |
| Redis (BullMQ queues) | Pending BullMQ jobs referencing outbox row ids | Relaxed durability; Postgres outbox + cron sweep is the recovery path. |
| Postgres `egress_rules` | `egress-allow` and `egress-inject` Contributions joined per grant | Existing table; same as today. Both kinds produce the same allow row; `egress-inject`'s credential rides a separate gateway-side rail. |
| K8s Secret per Connection | Auth credentials (refresh tokens, api-keys) | Owner-label-scoped; mounted into the paired gateway pod, never into the agent pod. |
| Per-agent PVC env snapshot file | Reconciled credential-placeholder env | Written by the `env` driver from the channel snapshot (in [`packages/agent-runtime/`](../../packages/agent-runtime/)); read by the harness/terminal spawn paths. |
| `agents` table — new columns | `runtime_protocol_version`, `runtime_capabilities`, `runtime_last_hello_at`, `runtime_agent_version` | Populated on every `hello`. |
| Per-Agent PVC | Materialized files, MCP config, installed skills | Driver-written via runtime channel. |
| Per-driver state file on the agent PVC | Driver's tracking of what it has previously written | Per-contribution-driver, opt-in. Section-marker file driver doesn't need it; key-targeted does. |

## Invariants

- **Mutation handlers never wait on agent reachability.** The user-facing response returns after the local transaction + BullMQ enqueue; delivery is the worker's concern. A hibernated, restarting, or unreachable agent does not delay or fail user actions.
- **Postgres is the source of truth.** Every agent-bound change has a durable representation (a Connection grant, an outbox row, an event row) before any wire activity. BullMQ jobs and runtime-channel calls are signal/delivery paths only; either may fail or be replayed without correctness loss, with the cron sweep as the recovery path.
- **State snapshots are idempotent; reapplying the latest snapshot is safe.** Drivers tolerate repeated apply. The agent's `lastAppliedVersion` rejects older state pushes; replay during disconnect/reconnect cannot regress state.
- **Events fire once per dedupe key and version.** The agent's local state store (applied cursor plus per-key last-run timestamp, persisted on the PVC) settles redelivered events without re-firing; the worker's `dispatched_at` stamp stops redelivery once acked.
- **One cursor for both slices.** The worker stamps `dispatched_at` for events with `version <= appliedVersion` in the same transaction that bumps `last_applied_version`. State and events share one ack marker.
- **The api-server is the only caller of `applyState` from the cluster.** The harness port admits ingress only from api-server pods; the agent's only outbound channel is the paired gateway, which routes back to the harness-API-server's `hello`.
- **Every Contribution kind has exactly one rail.** The api-server's fan-out determines which rail per kind; drivers, controller-render, and Envoy never overlap responsibilities on the same kind.
- **Capabilities are honored end-to-end.** A Contribution or Event kind not in the agent's advertised set is dropped at send time, never silently delivered. A grant that requires unsupported kinds succeeds with a UI warning; the unsupported parts simply don't appear in the agent's payload.
