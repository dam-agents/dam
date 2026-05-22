# ADR-048: Unified runtime channel — state snapshot plus event stream between api-server and agent-runtime

**Date:** 2026-05-21
**Status:** Proposed
**Owner:** @jezekra1

## Context

Configuration reaches a running agent through three disjoint mechanisms today: pod-files SSE (ADR-034) pushes user-editable config files; the controller drops trigger JSON into `~/.triggers/` via `kubectl exec` (ADR-008) for scheduled prompts; api-server initiates direct tRPC calls into the harness port for skills install/uninstall (ADR-030). MCP servers don't even have a delivery story — a single platform-outbound URL is written into `.mcp.json` once at boot from an env var. Each mechanism has its own transport, its own auth, its own failure model. None acknowledges delivery. None handles removal cleanly (`yaml-fill-if-missing` is additive only). None negotiates capabilities. Adding the `Contribution` model from ADR-047 to this surface would multiply the disjointness, not resolve it.

A single delivery shape covers both patterns the runtime channel needs: *complete desired state* (what the agent should converge to) and *delta from previous version* (one-shot actions the agent should perform). Conflating them under one semantic — either "everything is state" or "everything is an event" — drags the wrong properties onto half the payload. Splitting them at the payload level keeps each pattern's reconciliation rules explicit without bringing back a second route.

## Decision

Replace the three existing mechanisms with one tRPC channel between the api-server and agent-runtime. The wire payload has two named slices with different semantics:

- **`state`** — a complete desired-state snapshot (Contributions). Reconciled by diff against what's on the agent. Idempotent. Last-write-wins by per-agent monotonic `version`; `hash` short-circuits no-op pushes.
- **`events`** — an ordered stream of one-shot directives the agent must execute (trigger fires for now; rotate / rescan / … in the future). Processed in order. Each event's effect commits at the harness API at execution time, not at apply-ack time.

- **Two routes**, prefixed by protocol-major version. The api-server calls *into* the agent's harness port with `applyState` (push current `state` + currently-pending `events` for one agent). The agent calls *into* the api-server's harness-API-server port with `hello` (boot/wake catch-up — returns the same envelope if anything diverged) and `executeEvent` (per-event RPC the agent makes from inside its event handler, e.g. `sessions.create(triggerId, …)`). `executeEvent` is the natural per-event ack: its commit on the server is what marks the event dispatched. No persistent WebSocket; every interaction is a tRPC round-trip whose response carries the ack.

- **State semantics.** `applyState({ state, events })`'s `state` slice carries the complete desired Contribution set for one agent. The agent reconciles per-kind drivers, applying additions and removing what's no longer in the snapshot. Re-application is idempotent; replay-safe. The agent's `applyState` response carries `appliedVersion` and `appliedHash`; the api-server uses both to reject older deliveries from cross-replica races and to short-circuit no-op pushes when the agent's last hash matches the current one.

- **Event semantics.** Each event is `{ id, kind, payload, expiresAt }`. The agent processes events in order. Each event handler typically calls back into the harness API server (e.g. `sessions.create` for a `trigger` event); that call IS the per-event commit. The harness handler is idempotent on the event's stable id: a second call with the same id finds the existing side-effect row and returns it without redoing the work. The same call atomically stamps `dispatched_at` on the event's outbox row, removing it from the next snapshot. No agent-side persistent log is needed — the server-side side-effect row is the single source of truth for "has this event fired."

- **Two ack markers, two purposes.** `appliedVersion` / `appliedHash` (in the `applyState` response) close out the *state* slice. The per-event `executeEvent` RPC closes out each *event* individually. The two are independent: a payload can carry a no-op state slice with new events, or new state with no events; either ack channel can succeed while the other is in flight.

- **Capability negotiation.** The agent advertises in `hello` which Contribution kinds and which event kinds it supports (sourced from its runtime manifest, see below). The api-server **filters** outbound payloads to the advertised set; unsupported items are dropped at send time with a log line, never silently. The trigger event kind is built-in for every runtime — every agent that participates in the channel can fire sessions — but future kinds (rotate, rescan, …) are opt-in.

- **Versioning rule.** Adding a Contribution kind, an event kind, or an optional field to an existing payload does not bump the protocol — the capability flag carries the gate, and both sides parse leniently for unknown fields. A semantic break or required new field bumps the route-prefix major (`runtime.v1.*` → `runtime.v2.*`); both major versions coexist for one release window; per-agent dispatch reads the version the agent advertised on `hello`. The asymmetry is deliberate: an older agent on a newer server is the supported direction; a newer agent on an older server is rare (image-pinned) and fails loud rather than degrading silently.

- **Per-harness driver model on the agent side.** Each concrete agent image ships a `runtime-manifest.yaml` declaring which built-in or custom-registered impl handles each Contribution kind (e.g. `mcp-entry` → `file` impl with format/mergeMode/path/key parameters) and declares its capabilities. Custom impls are explicitly named in an `extensions` section of the manifest and may not collide with built-in impl names. The manifest version is independent of the protocol version. Event handlers are built-in per kind — pluggability is the contribution side, not events.

- **Removal semantics for `file` Contributions** depend on the merge mode the producer chose: `overwrite` and `section-marker` remove cleanly; `key-targeted` removes platform-owned keys; `yaml-fill-if-missing` cannot remove and is the legacy carve-out (existing producers stay on it; new producers must pick a remove-safe mode). Events have no removal semantics — they self-extinguish on commit.

## Alternatives Considered

- **One slice — fold events into the state snapshot as `pendingTriggers[]`** — rejected. The earlier draft of this ADR took this path. The two patterns end up colliding inside one field: state is set-shaped and reconciles by diff, events are stream-shaped and reconcile by per-id ack. Forcing them into one slice required an agent-side PVC dedupe log (so a crash between fire and apply-ack couldn't double-fire), server-side `dispatched_at` stamping on the apply ack, and an awkward semantic where "the snapshot represents events not-yet-fired" — a state assertion about a stream. Splitting state and events at the payload level keeps each pattern's natural reconciliation rules explicit and pushes idempotency to the server-side harness handler (where it's a single SQL constraint) instead of the agent's filesystem.

- **Two route pairs — `applyState` for state plus `deliverSignal` + `ack` for events** — rejected. Earlier draft. Two delivery rails (two outbox tables, two BullMQ queues, two ack semantics) duplicate the dispatch machinery to express what one payload with two named slices says natively. The wire shape already needs both fields; the operational surface should not.

- **Persistent WebSocket from agent to api-server with Redis fan-out across replicas** — rejected, doubles the connection-management surface (WS lifecycle, reconnect, keepalive) and introduces a routing concern across replicas (which one holds the WS for agent X) that an HTTP-request-per-event architecture sidesteps entirely.

- **Delta events for state too** — rejected. State is small, fully snapshotting it every time is cheap, and the hash short-circuit makes idle pushes essentially free. Delta state requires server-side per-agent journaling, sequence numbers, replay protection, and bootstrap-from-zero on schema changes. Events get delta semantics because they're inherently delta-shaped; state stays snapshot because it's inherently snapshot-shaped.

- **Same route name with version field in payload** — rejected, in-handler version dispatch leaks the abstraction into every handler, type unions get awkward, and removed versions can't return a clean HTTP 404.

- **Agent-side PVC dedupe log for events instead of server-side handler idempotency** — rejected. The server-side trigger handler already needs to know the trigger's stable id to look up the schedule context; making the handler idempotent on that id (e.g., `INSERT … ON CONFLICT (trigger_id) DO NOTHING RETURNING session_id`) is a one-statement change in the sessions module. Moving the dedupe to a file on the agent PVC adds a write the agent must `fsync` before returning, a JSON file to GC, and a forks-don't-have-this carve-out. The server-side dedupe is one column on a row the server already writes; the agent's event handler is a plain RPC with no local state.

## Consequences

- **Easier:** Adding a new contribution kind is one wire-format extension plus one agent-side driver; no new transport, no new auth path, no new failure model. The capability-flag rule means old agents harmlessly skip the new kind. Adding a new event kind is one entry in the event union plus one harness-side handler.

- **Easier:** Connection detach removes the connection's contributions from the agent's next snapshot; the agent's per-kind drivers handle removal where the merge mode allows it, no per-mechanism cleanup logic.

- **Easier:** Trigger delivery becomes durable end-to-end. The current `kubectl exec` file-drop has no retry; a failed exec loses the trigger. With events in the unified channel, a replica crash mid-dispatch leaves the event row in `runtime_events` for the next snapshot delivery, bounded only by `expires_at`.

- **Easier:** No agent-side persistent dedupe. Server-side handler idempotency (a unique constraint on `event.id` in the harness API's per-kind side-effect table) handles the crash-during-fire case cleanly. The agent's event handler is a plain RPC.

- **Easier:** Two named slices in one payload make the two patterns visible in the wire shape. Reviewers and future maintainers don't have to read implementation to learn that state is reconciled-by-diff and events are processed-and-committed.

- **Harder:** Concurrent mutations on the same agent from different replicas race on snapshot delivery; the per-agent monotonic `version` field on `state` is mandatory and agents must reject older versions. Without it the most-recent-write-loses race is silently incorrect.

- **Harder:** Every agent image now ships a `runtime-manifest.yaml`; cross-harness defaults in `platform-base` cover the common case but concrete agents must author overrides for harness-specific paths. The boot-time validation is fail-fast — a malformed manifest blocks agent startup instead of half-applying.

- **Harder:** The `yaml-fill-if-missing` legacy mode cannot express removal; producers using it leave stale entries on connection detach until the user edits the file. The constraint is documented in ADR-034 and inherited.

- **Harder:** The harness API server's per-event handlers must each be idempotent on the event's id. For the first kind (`trigger` → `sessions.create`), this is a unique constraint on a new `trigger_event_id` column joining sessions back to `runtime_events`. Future kinds inherit the same pattern.

- **Committed-to:** The three-route surface (`applyState`, `hello`, `executeEvent`) is the wire contract; further runtime-channel operations extend by adding capability-gated fields within `state` or `events`, or by a major bump. The `Contribution` kind set and the `Event` kind set both live here — adding either is a one-side change but removing either is a major bump. The runtime manifest schema is itself versioned and evolves on the same capability-flag-vs-major-bump rule applied to the wire protocol.

## Supersedes

- **ADR-008** (controller-owned cron with exec-based trigger delivery) — the `kubectl exec`-into-`~/.triggers/` mechanism retires; triggers become `events` entries on the unified channel, with the per-schedule serialization invariant preserved at the agent's event handler.
- **ADR-034** (push declarative file state to agent pods) — the SSE endpoint and the producer/registry abstraction it introduced retire; the producer concept survives but now emits `Contribution[]` for the unified channel rather than `FileSpec[]` for SSE.
- **ADR-030** (skills marketplace, in part) — the api-server's direct calls into agent-runtime's `skills.install` / `skills.uninstall` retire as a public contract; skill installation flows through `skill-ref` Contributions in the snapshot, with the existing skills helper functions retained as the driver's internal implementation. Source catalog, publish flow, and disk-side authority for installed skills are unchanged.

Pass-through mentions of pod-files, trigger files, and direct skills-tRPC in other ADRs (024, 035, 040, 041, 042, 043) remain unedited per the project's ADR-immutability convention.
