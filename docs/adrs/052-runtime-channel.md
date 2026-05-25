# ADR-052: Unified runtime channel — state snapshot plus event stream between api-server and agent-runtime

**Date:** 2026-05-21
**Status:** Proposed
**Owner:** @jezekra1

## Context

Configuration reaches a running agent through three disjoint mechanisms today: pod-files SSE (ADR-034) pushes user-editable config files; the controller drops trigger JSON into `~/.triggers/` via `kubectl exec` (ADR-008) for scheduled prompts; api-server initiates direct tRPC calls into the harness port for skills install/uninstall (ADR-030). MCP servers don't even have a delivery story — a single platform-outbound URL is written into `.mcp.json` once at boot from an env var. Each mechanism has its own transport, its own auth, its own failure model. None acknowledges delivery. None handles removal cleanly (`yaml-fill-if-missing` is additive only). None negotiates capabilities. Adding the `Contribution` model from ADR-051 to this surface would multiply the disjointness, not resolve it.

The runtime channel needs to carry two things that don't share semantics: an agent's *desired configuration* (which contributions should be on this pod) and the *one-shot directives* the platform wants the agent to execute (fire this trigger now). Forcing both into a single shape — either treating directives as a list inside the configuration snapshot, or treating configuration as a stream of edit events — drags the wrong properties onto half the payload. Splitting them at the wire level and sharing one ack cursor gives both their natural reconciliation rules without a second delivery rail.

## Decision

Replace the three existing mechanisms with one tRPC channel between the api-server and agent-runtime. The wire payload carries two named slices and a single shared cursor:

- **`version`** (top-level) — a per-agent monotonic counter. Every change — contribution edit, event insert — bumps this number for that agent. The agent's `appliedVersion` is the single ack marker for the whole payload.
- **`state`** — a complete desired-state snapshot (Contributions). Reconciled by diff against what's on the agent. Idempotent. `hash` short-circuits no-op pushes.
- **`events`** — an ordered stream of one-shot directives the agent must execute (trigger fires today; rotate / rescan / … in the future). Processed in order. Each event commits at its own per-kind handler **inside the agent-runtime** — there is no callback to the api-server for event work. The handler is idempotent via the agent's per-event cursor.

- **Two routes**, prefixed by protocol-major version. The api-server calls *into* the agent's harness port with `applyState` (push current `version`, `state`, and currently-pending `events` for one agent). The agent calls *into* the api-server's harness-API-server port with `hello` (boot/wake catch-up — returns the same envelope if anything diverged). Per-kind event work happens in-process inside the agent-runtime (e.g. trigger fires dispatch directly against the in-process ACP runtime via the `TriggerSessionDriver` port). No persistent WebSocket; every interaction is a tRPC round-trip whose response carries its own ack.

- **One cursor advances both state and events.** The agent's `applyState` response is `{ appliedVersion, appliedHash }`. On a successful ack, the api-server worker (the caller of `applyState`) runs one transaction: bumps `runtime_state_outbox.last_applied_version` to `appliedVersion`, and stamps `runtime_events.dispatched_at = now()` for all rows with `version <= appliedVersion AND dispatched_at IS NULL`. The next snapshot's state-builder filters events by `dispatched_at IS NULL`, so processed events are naturally excluded.

- **State semantics.** The `state` slice carries the complete desired Contribution set for one agent. The agent reconciles per-kind drivers, applying additions and removing what's no longer in the snapshot. Re-application is idempotent; replay-safe. `hash` is computed over the contribution list only — adding or processing events does not change it, so an events-only delivery short-circuits state reconciliation on the agent side.

- **Event semantics.** Each event is `{ id, kind, payload, version, expiresAt }`. The agent processes events in order. Per-kind handlers run **in-process inside the agent-runtime** and write only agent-local side effects (e.g. an ACP session). The agent's runtime-channel cursor (`lastAppliedVersion`, persisted on the agent PV in `runtime-state.json`) advances after each successfully-handled event, *not* once per `applyState` batch. Events whose `version` is at or below the agent's cursor are skipped before the handler is called — that single cursor IS the dedupe. There is no per-kind side-effect table on the server.

- **At-least-once with rare duplicates.** If the agent crashes after a handler commits its work but before the cursor advance is fsync'd to PV, the server resends the event and the handler runs again — producing one extra session in the worst case. For scheduled triggers this is the user-acceptable failure mode; the alternative (advance cursor before handler) silently drops fires on crash, which is worse for user-visible scheduled work.

- **Continuous-mode binding.** The trigger handler keeps a `scheduleId → sessionId` map on the agent PV (`trigger-state.json`) so the next continuous-mode tick of the same schedule resumes the prior ACP session. This is binding state, not dedupe state — it stays even if the runtime-channel cursor is reset.

- **Capability negotiation.** The agent advertises in `hello` which Contribution kinds and which Event kinds it supports (sourced from its runtime manifest, see below). The api-server **filters** outbound payloads to the advertised set; unsupported items are dropped at send time with a log line, never silently. The trigger event kind is built-in for every runtime — every agent that participates in the channel can fire sessions — but future kinds (rotate, rescan, …) are opt-in.

- **Versioning rule.** Adding a Contribution kind, an Event kind, or an optional field to an existing payload does not bump the protocol — the capability flag carries the gate, and both sides parse leniently for unknown fields. A semantic break or required new field bumps the route-prefix major (`runtime.v1.*` → `runtime.v2.*`); both major versions coexist for one release window; per-agent dispatch reads the version the agent advertised on `hello`. The asymmetry is deliberate: an older agent on a newer server is the supported direction; a newer agent on an older server is rare (image-pinned) and fails loud rather than degrading silently.

- **Per-harness driver model on the agent side.** Each concrete agent image ships a `runtime-manifest.yaml` whose `drivers` map binds each Contribution kind to an impl by name. Built-in impls (`file`, `mcp-entry`, `skill-install`) ship with the runtime channel; out-of-tree impls live in any npm package the agent image depends on and are declared in `extensions.impls[]` as `{ name, module, export }`. The runtime channel uses dynamic `import()` at boot to resolve each entry against the agent image's normal Node module resolution, asserts the exported value satisfies `{ pluginProtocolVersion, createPlugin }` (the marker is part of the wire contract — bumped on any breaking change to the plugin port), and registers the resulting `Plugin` in the dispatcher's registry. The agent's advertised `capabilities.contributions[]` is derived from the manifest's `drivers` map — no separate capability declaration. All plugins share one port: `bind(kind, binding) → KindHandler`, called once per binding at compose time; the plugin validates its own binding-config schema and may refuse kinds it doesn't support. Each plugin receives its own private state directory under `$HOME/.platform/plugins/<impl-name>/` on every dispatch — durable scratch for idempotency markers, install-history, cached checksums; the runtime channel never reads or writes inside it. Extension names may not collide with built-in names; to fully override a built-in's behavior, an agent image registers its replacement under a fresh name and rebinds the kind in `drivers` to point at it — the built-in stays registered but is never bound and never runs. Event handlers remain built-in per kind, dispatched in-process by the runtime-channel module — pluggability is the contribution side, not events.

- **Removal semantics for `file` Contributions** depend on the merge mode the producer chose: `overwrite` and `section-marker` remove cleanly; `key-targeted` removes platform-owned keys; `yaml-fill-if-missing` cannot remove and is the legacy carve-out (existing producers stay on it; new producers must pick a remove-safe mode). Events have no removal semantics — they self-extinguish via the cursor stamp.

## Alternatives Considered

- **Per-event ack via a response field (`processedEventIds`)** — rejected. Carrying per-event acks in the apply response splits the "is this event done" fact into two writes (the handler commit, plus the apply-response handler's stamp), which can disagree under partial-failure modes. The single-cursor model collapses to one write: the agent advances `lastAppliedVersion` after each handler commits, and the worker stamps `dispatched_at` server-side for events with `version ≤ appliedVersion` on `applyState` ack.

- **`version` nested under `state`** — rejected. The version is the shared cursor for both slices; nesting it under `state` mis-suggests that state has its own version distinct from events'. Top-level placement makes the single-cursor invariant visible at the wire shape.

- **Server-side per-kind handler with a side-effect table (`trigger_dispatches`)** — rejected. Two problems make this strictly worse than the agent-side cursor model: (a) the agent must roundtrip to the api-server to do work that is fundamentally local to the agent's ACP runtime — extra hop, extra moving parts (harness procedure, side-effect table per kind, ownership-resolving session-start port); (b) future event kinds (`rotate`, `rescan`) are all naturally agent-local too, so the pattern doesn't generalize cleanly. The agent-side cursor handles dedupe with one integer on the same PV the runtime channel already writes to.

- **Agent-side processed-event-id ring** — rejected. Equivalent to per-event cursor in coverage but adds a separate piece of state to read, write, GC, and reason about. The cursor already exists for state-reconciliation monotonicity; reusing it as the event dedupe is one less concept.

- **Advance cursor BEFORE invoking the handler (true at-most-once)** — rejected for triggers. Advancing first means a crash mid-handler silently drops the fire; the next schedule tick fires but the user-requested invocation is gone. The chosen "advance after success" model exposes one rare duplicate session instead, which is recoverable by the user.

- **One slice — fold events into the state snapshot as `pendingTriggers[]`** — rejected. Earlier draft. Events and contributions reconcile differently — contributions converge by diffing the desired set against what's on disk, events fire once and need a per-id "done" marker. Forcing both into one field meant the agent had to inspect each item's kind to know whether it represented "be in this state" or "do this thing." Two named slices make the difference visible at the wire level.

- **Two route pairs — `applyState` for state plus `deliverSignal` + `ack` for events** — rejected. Even earlier draft. Two delivery rails (two outbox tables, two BullMQ queues, two ack semantics) duplicate the dispatch machinery to express what one payload with two named slices and a cursor says natively.

- **Persistent WebSocket from agent to api-server with Redis fan-out across replicas** — rejected, doubles the connection-management surface (WS lifecycle, reconnect, keepalive) and introduces a routing concern across replicas (which one holds the WS for agent X) that an HTTP-request-per-event architecture sidesteps entirely.

- **Delta events for state too** — rejected. State is small, fully snapshotting it every time is cheap, and the hash short-circuit makes idle pushes essentially free. Delta state requires server-side per-agent journaling, sequence numbers, replay protection, and bootstrap-from-zero on schema changes.

- **Same route name with version field in payload** — rejected, in-handler version dispatch leaks the abstraction into every handler, type unions get awkward, and removed versions can't return a clean HTTP 404.

## Consequences

- **Easier:** Adding a new contribution kind is one wire-format extension plus one agent-side driver; no new transport, no new auth path, no new failure model. The capability-flag rule means old agents harmlessly skip the new kind. Adding a new event kind is one entry in the event union plus one agent-side handler that updates `event-loop`'s switch.

- **Easier:** Connection detach removes the connection's contributions from the agent's next snapshot; the agent's per-kind drivers handle removal where the merge mode allows it, no per-mechanism cleanup logic.

- **Easier:** Trigger delivery becomes durable end-to-end. The current `kubectl exec` file-drop has no retry; a failed exec loses the trigger. With events in the unified channel, a replica crash mid-dispatch leaves the event row in `runtime_events` for the next dispatch, bounded only by `expires_at`.

- **Easier:** Single cursor for everything. State monotonicity defense, event-done bookkeeping, and per-event redelivery skip-list share one integer (`lastAppliedVersion` on the agent PV; mirrored as `last_applied_version` on the server outbox). No side-effect tables, no per-kind idempotency constraints.

- **Easier:** Per-kind event handlers stay agent-local — they speak the agent's in-process protocols (ACP for triggers, future kinds get the same shape) without an api-server hop. The agent-runtime owns its own work; api-server's role is dispatch + ack accounting.

- **Harder:** Concurrent mutations on the same agent from different replicas race on snapshot delivery; the per-agent monotonic `version` and agent-side `lastAppliedVersion` are mandatory. Without them the most-recent-write-loses race is silently incorrect.

- **Harder:** Every agent image now ships a `runtime-manifest.yaml`; cross-harness defaults in `platform-base` cover the common case but concrete agents must author overrides for harness-specific paths. The boot-time validation is fail-fast — a malformed manifest blocks agent startup instead of half-applying.

- **Harder:** The `yaml-fill-if-missing` legacy mode cannot express removal; producers using it leave stale entries on connection detach until the user edits the file. The constraint is documented in ADR-034 and inherited.

- **Harder:** The agent-side cursor must be persisted on the PV after each event commits (one extra fsync per event). For typical schedules this is at most a few writes per minute — negligible IO. Forks don't have continuous-mode state to inherit; they begin with an empty cursor and skip nothing, which is fine because the server's `runtime_events` filter still excludes already-acked rows for the parent agent.

- **Harder:** A crash window between handler commit and cursor write produces rare duplicate session creations for triggers. Acceptable — the user-visible effect is one extra prompt run, not a lost schedule.

- **Committed-to:** The two-route surface (`applyState`, `hello`) is the wire contract; further runtime-channel operations extend by adding capability-gated fields within `state` or `events`, or by a major bump. The `Contribution` kind set and the `Event` kind set both live here — adding either is a one-side change but removing either is a major bump. The runtime manifest schema is itself versioned and evolves on the same capability-flag-vs-major-bump rule applied to the wire protocol.

## Supersedes

- **ADR-008** (controller-owned cron with exec-based trigger delivery) — the `kubectl exec`-into-`~/.triggers/` mechanism retires; triggers become `events` entries on the unified channel, with the per-schedule serialization invariant preserved at the agent's event handler.
- **ADR-034** (push declarative file state to agent pods) — the SSE endpoint and the producer/registry abstraction it introduced retire; the producer concept survives but now emits `Contribution[]` for the unified channel rather than `FileSpec[]` for SSE.
- **ADR-030** (skills marketplace, in part) — the api-server's direct calls into agent-runtime's `skills.install` / `skills.uninstall` retire as a public contract; skill installation flows through `skill-ref` Contributions in the snapshot, with the existing skills helper functions retained as the driver's internal implementation. Source catalog, publish flow, and disk-side authority for installed skills are unchanged.

Pass-through mentions of pod-files, trigger files, and direct skills-tRPC in other ADRs (024, 035, 040, 041, 042, 043) remain unedited per the project's ADR-immutability convention.
