# ADR-048: Unified runtime channel — snapshot + signal between api-server and agent-runtime

**Date:** 2026-05-21
**Status:** Proposed
**Owner:** @jezekra1

## Context

Configuration reaches a running agent through three disjoint mechanisms today: pod-files SSE (ADR-034) pushes user-editable config files; the controller drops trigger JSON into `~/.triggers/` via `kubectl exec` (ADR-008) for scheduled prompts; api-server initiates direct tRPC calls into the harness port for skills install/uninstall (ADR-030). MCP servers don't even have a delivery story — a single platform-outbound URL is written into `.mcp.json` once at boot from an env var. Each mechanism has its own transport, its own auth, its own failure model. None acknowledges delivery. None handles removal cleanly (`yaml-fill-if-missing` is additive only). None negotiates capabilities. Adding the `Contribution` model from ADR-047 to this surface would multiply the disjointness, not resolve it.

## Decision

Replace the three existing mechanisms with one bidirectional tRPC channel between the api-server and agent-runtime. Agent configuration travels as authoritative full-state **snapshots**; transient agent-directed actions travel as imperative **signal** events with explicit ack and TTL-bounded redelivery.

- **Two pairs of routes**, each side prefixed by protocol-major version. The api-server calls *into* the agent's harness port with `applyState` (push current `Contribution[]` snapshot keyed by version + content hash) and `deliverSignal` (push one transient directive). The agent calls *into* the api-server's harness-API-server port with `hello` (boot/wake catch-up — returns current state if hash diverged plus any pending signals) and `ack` (resolve a delivered signal). No persistent WebSocket; every interaction is a tRPC round-trip whose response carries the ack.
- **Snapshot semantics for state.** `applyState` carries the complete desired Contribution set for one agent. The agent reconciles per-kind, applying additions and removing what's no longer in the snapshot. Re-application is idempotent; replay-safe. The `lastAppliedHash` returned on `hello` short-circuits delivery when unchanged.
- **Signal semantics for transient actions.** Each signal carries a stable id (for agent-side dedupe), an action, an optional payload, and a TTL (default five minutes). The api-server retains unacked signals durably and redelivers on the next agent connection or via the outbox worker (ADR-049); acks resolve the durable row.
- **Capability negotiation.** The agent advertises in `hello` which Contribution kinds and which signal actions it supports (sourced from its runtime manifest, see below). The api-server **filters** outbound payloads to the advertised set; unsupported kinds are dropped at send time with a log line, never silently. UI surfaces the capability gap at grant time.
- **Versioning rule.** Adding a Contribution kind, a signal action, or an optional field to an existing payload does not bump the protocol — the capability flag carries the gate, and both sides parse leniently for unknown fields. A semantic break or required new field bumps the route-prefix major (`runtime.v1.*` → `runtime.v2.*`); both major versions coexist for one release window; per-agent dispatch reads the version the agent advertised on `hello`. The asymmetry is deliberate: an older agent on a newer server is the supported direction; a newer agent on an older server is rare (image-pinned) and fails loud rather than degrading silently.
- **Per-harness driver model on the agent side.** Each concrete agent image ships a `runtime-manifest.yaml` declaring which built-in or custom-registered impl handles each Contribution kind (e.g. `mcp-entry` → `file` impl with format/mergeMode/path/key parameters) and declares its capabilities. Custom impls are explicitly named in an `extensions` section of the manifest and may not collide with built-in impl names. The manifest version is independent of the protocol version.
- **Removal semantics for `file` Contributions** depend on the merge mode the producer chose: `overwrite` and `section-marker` remove cleanly; `key-targeted` removes platform-owned keys; `yaml-fill-if-missing` cannot remove and is the legacy carve-out (existing producers stay on it; new producers must pick a remove-safe mode).

## Alternatives Considered

- **Persistent WebSocket from agent to api-server with Redis fan-out across replicas** — rejected, doubles the connection-management surface (WS lifecycle, reconnect, keepalive) and introduces a routing concern across replicas (which one holds the WS for agent X) that an HTTP-request-per-event architecture sidesteps entirely.
- **One channel, snapshot-only, no signal class** — rejected, transient one-shot actions like "fire this trigger now" don't fit declarative state ("is this trigger still pending?" becomes a contradiction); the model forks naturally and the cost of forking it explicitly is one route pair.
- **Delta events instead of full snapshots** — rejected, requires server-side per-agent journaling, sequence numbers, ack protocol, replay protection, and bootstrap-from-zero on schema changes; snapshot semantics get idempotency, replay-safety, and easy migration for free.
- **Same route name with version field in payload** — rejected, in-handler version dispatch leaks the abstraction into every handler, type unions get awkward, and removed versions can't return a clean HTTP 404.

## Consequences

- **Easier:** Adding a new contribution kind is one wire-format extension plus one agent-side driver; no new transport, no new auth path, no new failure model. The capability-flag rule means old agents harmlessly skip the new kind.
- **Easier:** Connection detach removes the connection's contributions from the agent's next snapshot; the agent's per-kind drivers handle removal where the merge mode allows it, no per-mechanism cleanup logic.
- **Easier:** Trigger delivery becomes durable. The current `kubectl exec` file-drop has no retry; a failed exec loses the trigger. Signals with TTL + outbox redelivery (ADR-049) outlive replica restarts and agent disconnects within the TTL window.
- **Harder:** Concurrent mutations on the same agent from different replicas race on snapshot delivery; the per-agent monotonic `version` field on `applyState` is mandatory and agents must reject older versions. Without it the most-recent-write-loses race is silently incorrect.
- **Harder:** Every agent image now ships a `runtime-manifest.yaml`; cross-harness defaults in `platform-base` cover the common case but concrete agents must author overrides for harness-specific paths. The boot-time validation is fail-fast — a malformed manifest blocks agent startup instead of half-applying.
- **Harder:** The `yaml-fill-if-missing` legacy mode cannot express removal; producers using it leave stale entries on connection detach until the user edits the file. The constraint is documented in ADR-034 and inherited.
- **Committed-to:** The four-route surface (`applyState`, `deliverSignal`, `hello`, `ack`) is the wire contract; further runtime-channel operations extend by adding capability-gated routes within a version, or by a major bump. The `Contribution` kind set governance lives here — adding a kind is a one-side change but removing one is a major bump. The runtime manifest schema is itself versioned and evolves on the same capability-flag-vs-major-bump rule applied to the wire protocol.

## Supersedes

- **ADR-008** (controller-owned cron with exec-based trigger delivery) — the `kubectl exec`-into-`~/.triggers/` mechanism retires; triggers become signal events with the same per-schedule serialization invariant preserved at the signal-handling layer.
- **ADR-034** (push declarative file state to agent pods) — the SSE endpoint and the producer/registry abstraction it introduced retire; the producer concept survives but now emits `Contribution[]` for the unified channel rather than `FileSpec[]` for SSE.
- **ADR-030** (skills marketplace, in part) — the api-server's direct calls into agent-runtime's `skills.install` / `skills.uninstall` retire as a public contract; skill installation flows through `skill-ref` Contributions in the snapshot, with the existing skills helper functions retained as the driver's internal implementation. Source catalog, publish flow, and disk-side authority for installed skills are unchanged.

Pass-through mentions of pod-files, trigger files, and direct skills-tRPC in other ADRs (024, 035, 040, 041, 042, 043) remain unedited per the project's ADR-immutability convention.
