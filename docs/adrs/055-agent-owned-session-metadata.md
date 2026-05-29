# ADR-055: Agent-owned session metadata via ACP `_meta`; no server-side session store

**Date:** 2026-05-28
**Status:** Accepted
**Owner:** @jezekra1
**Supersedes:** ADR-017
**Amends:** ADR-019

## Context

ADR-017 placed the Postgres `sessions` table as the source of truth for session existence and metadata, with the ACP relay writing a row on the first `session/prompt` it intercepted. Three later decisions reshaped the landscape:

- **ADR-026** made the agent-runtime "session-state-authoritative" — it owns per-session logs and serves `session/load` from its own log when populated.
- **ADR-037** split sessions into `chat` and `terminal` modes — terminal mode runs the harness in TUI against a PTY and **bypasses ACP entirely**.
- **ADR-052** moved schedule trigger dispatch in-process inside agent-runtime — no longer traverses the relay.

The relay-intercept-on-first-prompt write trigger now misses two cases:

- **Schedule-fired sessions** (#391) — the trigger handler dispatches the session in-process via `TriggerSessionDriver`; no relay write fires.
- **Terminal `/clear`-spawned sessions** (#399) — the harness mints a fresh session internally during a TUI loop; the PTY path never goes through ACP.

The result is two stores claiming ownership of *what sessions exist*: Postgres `sessions` and the harness's on-disk JSONL store at `~/.claude/projects/<cwd>/`. They diverge silently in the cases above, and the UI hides what the agent actually has.

Crucially, the server holds no session data anyone needs it to hold. Every consumer of session state either **already speaks ACP to the agent** (the UI over the relay WebSocket; the Slack/Telegram workers over a per-turn ACP client) or **runs in-pod** (schedule dispatch). The `sessions` table is pure overhead in front of a listing the agent can serve directly.

## Decision

The agent is the **sole source of truth** for session existence and metadata. There is **no server-side session store** — no Postgres `sessions` table, no cache, no server-side sessions data-service. Platform metadata (mode, type, scheduleId, threadTs, createdAt) travels via standard ACP `_meta.platform.*`, and every reader reads it straight off `session/list` over an ACP connection it already holds. The agent-runtime — not the harness — is the platform's metadata layer inside the pod.

### The agent-runtime is the metadata owner

The agent-runtime already proxies every ACP frame between clients and the harness ([ADR-026](026-session-log-replay.md)). Two existing intercepts gain a metadata-aware step:

- **`session/new` request** — strip `_meta.platform.*` keys before forwarding to the harness; on response, persist `{ sessionId → platformMeta, createdAt }` to a runtime-owned state file on the agent's PVC, alongside `trigger-state.json` (the pattern [ADR-052](052-runtime-channel.md) established for trigger binding state).
- **`session/list` response** — for each `SessionInfo` returned by the harness, look up the stored entry and inject `_meta.platform.*` back into the response. Sessions present in the state file but not yet in the harness's on-disk store (created but never prompted — the SDK persists on first turn) are added with `title: null, updatedAt: null`.

The harness stays vanilla. `claude-agent-acp@0.33.1` accepts `_meta` on `session/new` without error but does not persist it and never sets `_meta` on `SessionInfo`. The runtime's intercept makes this irrelevant.

### Mapping rule: `_meta` absent ⇒ terminal session default

The harness's `listSessions` reads from the SDK's on-disk store at `~/.claude/projects/<cwd>/*.jsonl`, which is **shared between ACP and TUI** — TUI sessions appear in the same listing. ACP-mediated sessions carry `_meta` because the platform's clients write it on `session/new`; TUI sessions carry none because the TUI doesn't speak ACP.

Decoding: a listed session whose runtime store has no entry defaults to `{ mode: terminal, type: regular }`. This is the discriminator for harness-internally-minted sessions (`/clear`, future cases) without any platform-side write.

### Readers read ACP `session/list` directly — there is no server store

Every reader already holds (or cheaply opens) an ACP connection to the agent, and the relay auth-gates that connection by Agent ownership at WebSocket upgrade. So the read is already authorized, and no server-side session endpoint is needed:

- **UI** — uses the relay ACP WebSocket it already maintains for chat. List is `session/list` (decoding `_meta.platform` client-side); create is `session/new` stamping `_meta.platform`; mode change is `session/resume` with `_meta.platform.mode`; delete is the `platform/deleteSession` ExtRequest. No `sessions.*` server procedures.
- **Channel workers (Slack/Telegram)** — each turn already opens an ACP client to the agent. To continue a thread it calls `session/list` and matches on `_meta.platform.threadTs`, then resumes that session or creates a new one stamping `{ type: channel_*, threadTs }`. The worker never tracks a sessionId or consults the server — `threadTs`, not a session id, is the channel's key.
- **Schedules** — the agent-runtime already resolves `scheduleId → session` in-pod (`trigger-state-store`) for continuous fires. The server's only session-related action is enqueuing the **reset** runtime event over the durable outbox ([ADR-053](053-runtime-outbox-worker.md)), which belongs to the schedules module, not a session store.

What this removes: the Postgres `sessions` table, the server sessions data-service and its repository, and any cache. The ACP relay reverts to a dumb proxy ([ADR-007](007-acp-relay.md)) that writes nothing.

The one cost: **listing requires the agent to be reachable.** This is free in practice — every real read path already wakes or uses the agent (opening it in the UI wakes it; an incoming channel message wakes it; a schedule fires in-pod). We therefore drop ADR-017's "list sessions while the pod is hibernated" guarantee: there is no cross-agent dashboard that lists sleeping agents' sessions, so nothing depends on it.

### Delete via ACP `ExtRequest`, with hard-or-soft fallback

ACP defines `ExtRequest` for "arbitrary requests not part of the spec, while maintaining protocol compatibility." [Zed](https://github.com/zed-industries/zed) uses the same pattern: a capability-gated `delete_session` extension. Platform follows this:

- **Method**: `platform/deleteSession` via `ExtRequest`.
- **Runtime proxy always supports it.** At minimum the runtime purges the session's entry from its metadata store and tombstones the sessionId so subsequent `session/list` enrichment filters it out.
- **Hard delete when the harness supports it.** If the harness advertises a delete capability in `initialize`, the runtime forwards the request — removing the JSONL on PVC. Today's `claude-agent-acp` does not, so we soft-delete.
- **Soft delete otherwise.** The tombstone keeps the session invisible; the JSONL leaks on the PVC but the user-facing contract (delete = gone from list) holds.

`session/close` is **not** reused for delete: in `claude-agent-acp@0.33.1`, `closeSession` throws "Session not found" for any session not currently loaded, so deleting an idle session would mean loading it (spawning a subprocess) just to close it. `closeSession` is runtime teardown, not on-disk deletion.

### `setMode` is metadata-only — no harness restart

ADR-037 framed mode-switching as "requires harness restart." That conflated the *process* the harness runs as (ACP daemon vs TUI) with the *categorization* of a session in the UI. Under this ADR, mode is metadata: a UI hint about which surface to render, persisted in `_meta.platform.mode`. Mode updates ride `ResumeSessionRequest._meta`; the runtime intercepts and updates its store. No new RPC, no restart.

### No archive feature

Zed's "Archive Thread" is purely client-side: a reversible flag the agent never knows. We do not ship archive here. If demand emerges, follow Zed with a client-side flag — no ACP involvement.

## Alternatives Considered

- **A server-side session cache (Redis hash per agent) for hibernated-pod listing.** An earlier draft of this ADR kept exactly this, so `sessions.list` could serve a sleeping agent. Rejected during implementation: every actual reader already has the agent reachable — the UI's chat connection wakes it, an incoming channel message wakes it, a schedule fires in-pod — so the cache served only a hypothetical "list every agent's sessions without waking them" view that does not exist. It cost a whole storage substrate, a one-shot migration, and cache-invalidation logic for no real consumer. Removing it deletes the server sessions service, its repository, and the cache outright.

- **Keep ADR-017's shape and fix the write triggers.** Smaller change. Rejected: leaves the structural divergence in place and forces every new session origin to grow a bespoke write path.

- **Per-source binding tables** (`slack_threads`, `schedule_sessions`, …). Rejected for shape simplicity — metadata co-located on the agent, keyed off `_meta`.

- **Metadata stays server-side; agent never sees it.** Each creator writes via a server endpoint at creation. Rejected: keeps the server as the metadata source, which is exactly the overhead this ADR removes, and still needs a reconciler for agent-internal mintings.

- **Upstream PR to `claude-agent-acp` to round-trip `_meta`.** Confirmed not implemented in 0.33.1. Rejected: depends on an external release cadence and multiplies across each harness. The agent-runtime intercept achieves it harness-agnostically.

- **`session/close` with a delete marker.** Rejected: `closeSession` throws on idle sessions.

- **Event-driven push from runtime to api-server for new sessions.** Rejected: there is no server store to push to, and every reader pulls `session/list` on demand.

## Consequences

### Easier

- Schedule-fired and `/clear`-spawned sessions appear by construction — closes #391 and #399.
- The server owns **no** session state: no table, no cache, no migration backfill (just drop the table), no sessions data-service. The ACP relay is a dumb proxy again.
- One read path for everyone — `session/list` decoding `_meta.platform` — over a connection each reader already holds. A new session origin needs no server write path: stamp `_meta` on `session/new` and it appears.
- Delete and setMode are ACP operations any client issues directly; no server endpoints.

### Harder

- Listing requires the agent reachable; ADR-017's hibernated-pod listing guarantee is gone. Acceptable — no read path lists a sleeping agent.
- The UI gains a `session/list` path over its ACP connection (previously a tRPC call) and decodes `_meta.platform` client-side.
- Channel workers self-resolve `threadTs` via `session/list` instead of a DB lookup; they no longer track session ids.
- ADR-019's no-`_meta` clause is amended (below); contributors must know `_meta.platform.*` is platform-owned via the runtime intercept.
- Mode-as-metadata reframes ADR-037; UI code that treated mode changes as lifecycle events needs review.

### Committed-to

- The agent-runtime's session-metadata state file (on the PVC) is the platform's sole durable source of truth for session metadata.
- ACP `_meta.platform.*` is the wire format — reads on `session/list`, writes on `session/new` / `session/resume`. `_meta.platform.*` is the reserved key namespace.
- `ExtRequest` platform methods are how session-lifecycle operations the ACP spec lacks are added; `platform/deleteSession` is the first.
- The "`_meta` absent ⇒ terminal default" rule is the discriminator for harness-internal mintings.

## Supersedes

- **ADR-017** (DB-backed ACP sessions for metadata) — fully. Postgres no longer stores sessions; the agent is canonical and there is no server-side session store at all. ADR-017's "sessions visible when pods are hibernated" guarantee is intentionally dropped (see Consequences): every read path already has the agent reachable.

## Amends

- **ADR-019** (Scheduled session identity and lifecycle) — its "no harness-specific `_meta` fields" clause is narrowed: **platform-defined `_meta.platform.*` keys, round-tripped by the agent-runtime intercept (not the harness)**, are how the platform carries metadata over ACP. ADR-019's `sessions` table `schedule_id` column is obsolete — the binding lives in `_meta.platform.scheduleId` and the agent's in-pod trigger-state.
