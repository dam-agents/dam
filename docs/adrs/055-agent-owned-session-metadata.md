# ADR-055: Agent-owned session metadata via ACP `_meta`; server sessions become a Redis cache

**Date:** 2026-05-28
**Status:** Proposed
**Owner:** @jezekra1
**Supersedes:** ADR-017 (in part)
**Amends:** ADR-019

## Context

ADR-017 placed the Postgres `sessions` table as the source of truth for session existence and metadata, with the ACP relay writing a row on the first `session/prompt` it intercepted. Three later decisions reshaped the landscape:

- **ADR-026** made the agent-runtime "session-state-authoritative" — it owns per-session logs and serves `session/load` from its own log when populated.
- **ADR-037** split sessions into `chat` and `terminal` modes — terminal mode runs the harness in TUI against a PTY and **bypasses ACP entirely**.
- **ADR-052** moved schedule trigger dispatch in-process inside agent-runtime — no longer traverses the relay.

The relay-intercept-on-first-prompt write trigger now misses two cases:

- **Schedule-fired sessions** (#391) — the trigger handler dispatches the session in-process via `TriggerSessionDriver` ([`trigger-impl.ts:27-34`](../../packages/agent-runtime/src/modules/runtime-channel/drivers/trigger-impl.ts)); no relay write fires.
- **Terminal `/clear`-spawned sessions** (#399) — the harness mints a fresh session internally during a TUI loop; the PTY path never goes through ACP.

The result is two stores claiming ownership of *what sessions exist*: Postgres `sessions` and the harness's on-disk JSONL store at `~/.claude/projects/<cwd>/`. They diverge silently in the cases above, and the UI hides what the agent actually has.

`sessions.list` already half-acknowledges this: it overlays live ACP data on DB rows ([`sessions-service.ts:72-116`](../../packages/api-server/src/modules/sessions/services/sessions-service.ts)) but the DB existence gate still hides agent-only sessions. Fixing each new write site individually scales poorly — every future session origin (CLI, agent-internal mintings, multi-agent forks) repeats the same write-path question.

## Decision

Flip the ownership: the agent is the source of truth for session existence; the server stores a cache. Platform metadata (mode, type, scheduleId, threadTs, createdAt) travels via standard ACP `_meta` on `session/new` and `session/list`. The agent-runtime — not the harness — is the platform's metadata layer inside the pod.

### The agent-runtime is the metadata owner

The agent-runtime already proxies every ACP frame between clients and the harness ([ADR-026](026-session-log-replay.md)). Two existing intercepts gain a metadata-aware step:

- **`session/new` request** — strip `_meta.platform.*` keys before forwarding to the harness; on response, persist `{ sessionId → platformMeta, createdAt }` to a runtime-owned state file on the agent's PVC, alongside `trigger-state.json` (the same pattern [ADR-052](052-runtime-channel.md) established for trigger binding state).
- **`session/list` response** — for each `SessionInfo` returned by the harness, look up the stored entry and inject `_meta.platform.*` back into the response. Sessions present in the state file but not yet in the harness's on-disk store (created but never prompted — the SDK persists on first turn) are added with `title: null, updatedAt: null`.

The harness stays vanilla. `claude-agent-acp@0.33.1` accepts `_meta` on `session/new` without error but does not persist it (`createSession` reads only `_meta.systemPrompt`, `_meta.claudeCode.options`, `_meta.disableBuiltInTools`) and never sets `_meta` on `SessionInfo` ([`acp-agent.js:374-389`](https://github.com/zed-industries/claude-code-acp)). The runtime's intercept makes this irrelevant.

### Mapping rule: `_meta` absent ⇒ terminal session default

The harness's `listSessions` reads from the SDK's on-disk store at `~/.claude/projects/<cwd>/*.jsonl`, which is **shared between ACP and TUI** — TUI sessions appear in the same listing. ACP-mediated sessions carry `_meta` because the platform's clients write it on `session/new`; TUI sessions carry none because the TUI doesn't speak ACP.

Decoding: a listed session whose runtime store has no entry defaults to `{ mode: terminal, type: regular }`. This is the discriminator for harness-internally-minted sessions (`/clear`, future cases) without any platform-side write.

### Server cache: Redis, not Postgres

Replace the Postgres `sessions` table with a Redis hash per agent. Redis is already a platform primitive ([ADR-036](036-redis-platform-primitive.md)). Properties:

- **Lazy pull**: `sessions.list` calls the runtime; on success, refreshes the Redis hash and returns the merged view. On runtime failure (pod hibernated, network blip), returns the cached hash unchanged.
- **Hibernated-pod UX preserved** — Redis persistence (AOF/RDB) keeps the cache durable across api-server and Redis restarts. ADR-017's "session listing works even when pods are hibernated" guarantee survives.
- **Cache invalidation on alive-pod reads** — a session in cache but not in the runtime list, with the pod confirmed alive, is dropped from cache (true cache semantics: agent is canonical).

Migration is one-shot at deploy: a backfill script reads existing Postgres `sessions` rows, calls a runtime endpoint per agent to seed the metadata store, then drops the table.

### Delete via ACP `ExtRequest`, with hard-or-soft fallback

ACP defines `ExtRequest` for "arbitrary requests not part of the spec, while maintaining protocol compatibility." [Zed](https://github.com/zed-industries/zed) uses the same pattern: a capability-gated `delete_session` extension method (the `supports_delete` capability advertised by the agent in `initialize`). Platform follows this:

- **Method**: `platform/deleteSession` via `ExtRequest`, called by the api-server's delete handler.
- **Runtime proxy always supports it.** At minimum, the runtime purges the session's entry from its metadata store and tombstones the sessionId so subsequent `session/list` enrichment filters it out.
- **Hard delete when the harness supports it.** If the harness advertises a delete capability in `initialize`, the runtime forwards the request — removing the JSONL on PVC. Today's `claude-agent-acp` does not, so we soft-delete.
- **Soft delete otherwise.** The tombstone in the metadata store keeps the session invisible. The JSONL leaks on the PVC but the user-facing contract (delete = gone from list) holds.

`session/close` is **not** reused for delete. In `claude-agent-acp@0.33.1` ([`acp-agent.js:857`](https://github.com/zed-industries/claude-code-acp)), `closeSession` throws "Session not found" for any session not currently loaded in memory — to delete an idle session this way you would have to load it first (spawning a subprocess) just to close it. The semantic mismatch is the giveaway; `closeSession` is runtime teardown, not on-disk deletion.

### `setMode` is metadata-only — no harness restart

ADR-037 framed mode-switching as "requires harness restart, only possible cleanly if agent is idle." That conflated two things — the *current process* the harness runs as (ACP daemon vs TUI) and the *categorization* of a session in the UI. Under this ADR, mode is metadata: a UI hint about which surface to render, persisted in `_meta.platform.mode`. The running harness is unaffected by a mode change; the harness lifecycle remains driven by whether ACP or PTY traffic is flowing.

Mode updates ride `ResumeSessionRequest._meta` — already part of the protocol. When the user reopens a session in a different surface, the resume call carries the new `_meta.platform.mode`; the runtime intercepts and updates its metadata store. No new RPC, no harness restart.

### No archive feature

Zed's "Archive Thread" button is purely client-side ([`crates/agent_ui/src/thread_metadata_store.rs`](https://github.com/zed-industries/zed)): a SQLite flag, reversible, the agent never knows. We do not ship an archive feature in this ADR. If demand emerges later, follow Zed: a Redis-side flag, no ACP involvement.

## Alternatives Considered

- **Keep ADR-017's shape and fix the write triggers.** Add a schedule-handler→server callback and a reconciler for `/clear` discovery. Smaller change. Rejected: leaves the structural divergence in place and forces every new session origin to grow a bespoke write path. The "cache" framing of `sessions.list` would stay half-true.

- **Per-source binding tables** (`slack_threads`, `schedule_sessions`, `terminal_sessions`) with the `sessions` row stripped to existence + timestamp. Cleaner DDD alignment. Rejected by the project owner for shape simplicity — one row per session, metadata co-located.

- **Metadata stays server-side; agent never sees it.** Each creator (UI, Slack, schedule) writes via `sessions.create` at creation time; reconciler for agent-internal mintings. Lower implementation cost, no runtime extension needed. Rejected: keeps the server as the metadata source, which contradicts the cache property — without it, the table can't be wiped and rebuilt from the agent.

- **Upstream PR to `claude-agent-acp` and `@anthropic-ai/claude-agent-sdk` to round-trip `_meta`.** Confirmed not implemented in 0.33.1. Rejected: dependent on an external project's release cadence, multiplies across each supported harness (claude-code, codex, gemini-cli). The agent-runtime intercept achieves the same effect harness-agnostically.

- **Write platform metadata into the harness's session JSONL.** Append a platform metadata entry directly to the SDK's on-disk session file. Rejected: requires platform writes into a file the harness owns; fragile across SDK versions.

- **`session/close` with a delete marker.** Rejected: `closeSession` throws on idle sessions in `claude-agent-acp@0.33.1`. Using it for delete forces loading the session first to close it — wasteful and protocol-abusive.

- **Event-driven push from runtime to api-server for new sessions.** Reuse ADR-052's event slice but reversed. Rejected: lazy pull is sufficient; reversing the runtime channel directionality pulls in significant complexity for an eventually-consistent list.

- **Postgres-backed cache instead of Redis.** Possible. Rejected: a cache is the wrong shape for a typed schema with migrations. Redis's per-agent hash, TTL options, and lighter operational profile fit the cache role naturally. Postgres remains the substrate for everything else api-server owns ([persistence.md](../architecture/persistence.md)).

## Consequences

### Easier

- Schedule-fired and `/clear`-spawned sessions appear in the UI by construction — closes #391 and #399.
- The ACP relay stops being a session-table writer; it can revert to a dumb proxy per ADR-007.
- Adding a new session origin needs no special platform write path. The creator includes `_meta` on `session/new`; everything else is automatic.
- `sessions.list` becomes a single read-through: call runtime, refresh cache, return. No conditional write logic.
- Delete extends to future ACP-spec additions: when a harness adds a real delete capability, the runtime promotes soft → hard automatically.

### Harder

- The agent-runtime gains one more persistent state file on the PVC. Backup and reasoning surface grows by one file per agent.
- Redis persistence config (AOF/RDB) becomes load-bearing for the hibernated-pod UX. A cold Redis cache shows empty session lists until each agent wakes and is re-listed.
- One-shot migration script is needed at cutover (read Postgres rows → seed runtime state files → drop table). Coordinated with a deploy.
- ADR-019's no-`_meta` clause is amended; future contributors need to know that `_meta.platform.*` is owned by the platform via the runtime intercept (not by the harness).
- Mode-as-metadata is a meaningful reframe of ADR-037. UI code that assumed mode changes were lifecycle events needs review.

### Committed-to

- The agent-runtime's session metadata store is the platform's durable source of truth for session metadata. The Redis cache is reconstructable from it.
- ACP `_meta` (writes on `session/new`/`session/resume`, reads on `session/list`) is the wire format for platform session metadata. `_meta.platform.*` is the reserved key namespace.
- `ExtRequest`-based platform methods are the way to add session-lifecycle operations the ACP spec does not cover. `platform/deleteSession` is the first; future additions follow the same shape (capability-gate when the harness can do it, runtime fallback otherwise).
- The "`_meta` absent ⇒ terminal default" rule is the discriminator for harness-internal session mintings. Any future origin must either set `_meta` or accept the default.

## Supersedes

- **ADR-017** (DB-backed ACP sessions for metadata) — in part. The "DB is the source of truth for session existence and metadata" decision is reversed: the agent is now canonical, and the platform-side store is a cache. ADR-017's UX guarantee (sessions visible when pods are hibernated) is preserved via Redis persistence; the storage substrate moves from Postgres to Redis.

## Amends

- **ADR-019** (Scheduled session identity and lifecycle) — its "no harness-specific `_meta` fields, no Claude Code options" clause is narrowed. Harness-specific `_meta` extensions remain forbidden; **platform-defined `_meta.platform.*` keys, round-tripped by the agent-runtime intercept rather than by the harness**, are how the platform carries metadata over ACP going forward. ADR-019's `sessions` table column additions (`schedule_id`) are obsolete under this ADR — the binding lives in `_meta.platform.scheduleId` on the agent's metadata store, cached in Redis.
