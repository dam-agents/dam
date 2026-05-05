# ADR-DRAFT: Scheduled session identity and lifecycle

**Date:** 2026-04-14
**Status:** Proposed
**Owner:** @janjeliga
**Amends:** ADR-008
**Builds on:** ADR-017

## Context

ADR-008 established trigger delivery via file drops, with agent-runtime creating a **new ACP session per trigger file**. The trigger-watcher (`trigger-watcher.ts`) calls `session/new` on every trigger, spawns an ACP process, sends `session/prompt`, and kills the process on completion. This session-per-trigger model has three problems:

1. **No history retention** — schedules are inherently recurring. Each run starting from zero means the agent cannot reference prior results or build on accumulated context. A schedule that checks system health every 10 minutes has no memory of what it found 10 minutes ago.

2. **UI clutter** — every trigger creates a session visible in the main sessions sidebar. A schedule running hourly produces 24 sessions/day, burying interactive sessions.

3. **Wasted resources** — each trigger bootstraps a full session from scratch (system prompt, tool discovery, MCP server connection) only to throw it all away.

ADR-017 introduced a `sessions` PostgreSQL table with a `type` discriminator (`regular`, `channel_slack`) and server-side filtering. This infrastructure directly solves the session classification and filtering problem — schedule sessions are a new type in the same model.

## Decision

### Only cron schedules — heartbeat considered but not used

An earlier design included a separate "heartbeat" schedule type — a recurring interval-based wake-up where the agent reads `.config/heartbeat.md` and decides what to do. This was rejected because the functionality does not align with our current setup: heartbeats duplicate what cron schedules already provide. A cron schedule with `sessionMode: "continuous"` achieves the same outcome (persistent session, recurring execution) with a single unified mechanism. Maintaining two schedule types would add complexity without meaningful benefit. This functionality will be adressed separately from vanilla schedules later.

### A scheduled session is just a normal session

There is nothing architecturally special about a scheduled session. ACP already handles session persistence — messages are stored to disk and survive process death. The existing `session/resume` ACP method loads a persisted session into a new process. The UI already uses this when a user clicks a session in the sidebar.

A scheduled tick works exactly like a user returning to a conversation:

1. Process spawns
2. `session/resume` loads persisted messages from disk
3. `session/prompt` sends the new prompt
4. Agent responds
5. Process dies, messages persist

A user can also open a schedule's session in the UI between ticks, interact with it manually, and close it. The next tick continues the same conversation. The session is shared — the schedule and the user are just two sources of prompts into the same conversation.

### Session-per-schedule, not session-per-trigger

Each schedule gets **its own session**. The first trigger creates it via `session/new`; all subsequent triggers resume it via `session/resume`. A schedule running hourly produces one session with 24 turns per day, not 24 separate sessions.

If an instance has multiple cron schedules, each gets its own independent session — they are separate conversations with separate tasks and should not interleave.

### Session mode: continuous vs fresh

Cron schedules get a `sessionMode` field:

- `"continuous"` — resume the same session on each fire
- `"fresh"` (default) — create a new session on each fire (current behavior)

```typescript
interface ScheduleSpec {
  version: string;
  type: "cron";
  cron: string;
  task?: string;
  enabled: boolean;
  sessionMode?: "continuous" | "fresh";  // NEW
}
```

### Session type in the DB

ADR-017's `SessionType` enum is extended with a schedule type:

```typescript
const SessionType = {
  Regular: "regular",
  ChannelSlack: "channel_slack",
  ScheduleCron: "schedule_cron",       // NEW
} as const;
```

The `sessions` table gains an optional `scheduleId` column to link sessions back to their schedule:

```sql
ALTER TABLE sessions ADD COLUMN schedule_id TEXT;
```

This follows the same pattern as ADR-017 — the DB is the source of truth for session existence and metadata; ACP enriches with title/updatedAt at query time.

### Trigger-watcher as a sessions API client

The trigger-watcher is just another client of the sessions API — no different from the UI or the Slack worker. It reads and writes sessions through the API server over the cluster network, following the same patterns ADR-017 established.

For a **continuous** cron schedule:

1. Query the API server for the session with this `scheduleId`
2. If found → `session/resume`, then `session/prompt`
3. If not found (first run) → `session/new`, then `session/prompt`, persist via `sessions.create` with the `scheduleId`

For a **fresh** cron schedule: always `session/new`, persist each session with the `scheduleId`. The schedule accumulates a list of sessions over time.

If `session/resume` fails (session corrupted, deleted), the trigger-watcher reports an error. The user can reset the schedule, and the next tick creates a fresh session.

### Trigger file lifecycle and serialization

The current trigger-watcher deletes trigger files immediately before processing. This means a pod crash during processing loses the trigger. Instead, trigger files should be **deleted on completion**, turning the filesystem into a durable at-least-once delivery mechanism:

- Trigger file lands on disk → delivery succeeded (PVC-backed, survives pod restarts)
- Trigger-watcher picks it up, tracks it in an in-process inflight set to avoid duplicate processing
- On completion → deletes the file
- Pod crashes mid-processing → file survives on PVC → picked up on restart (the watcher already scans for existing files on startup)

For continuous sessions, two triggers for the same schedule must not run concurrently (interleaved turns would corrupt the conversation). If a trigger arrives for a schedule that's already inflight, the file stays on disk. The watcher picks it up after the current run completes. This gives natural serialization within a schedule without a distributed queue — the trigger files on disk are the queue.

Concurrency across different schedules is unaffected.

### UI changes

Schedule sessions use the same DB-backed filtering that ADR-017 established for channel sessions. The `sessions.list` endpoint already filters by type — schedule sessions are excluded from the sessions sidebar by default.

The **schedules tab** shows sessions in context:

- **Continuous schedule** — shows a single session. Clicking it opens the conversation via `session/load`. The user can interact with it directly.
- **Fresh cron schedule** — shows a list of sessions (one per fire), most recent first. Each is clickable. This keeps them organized under the schedule rather than cluttering the main sidebar.

A **reset button** on continuous schedules clears the stored session ID (removes the `scheduleId` link in the DB). The next tick creates a fresh session. The old session remains accessible under the schedule's session history.

### Schedule lifecycle

- **Schedule deleted** — the session is orphaned but not automatically deleted. The delete UI offers a checkbox to also delete the associated session(s).
- **Schedule disabled then re-enabled** — the session is preserved. The next tick continues the same conversation as if nothing happened.
- **Instance deleted** — the PVC is deleted, all sessions (including schedule sessions) are gone. DB rows can be cleaned up via cascade or periodic reconciliation.

### Context growth is the agent's problem

A continuous session accumulates messages over time. The platform does **not** manage context window limits, compaction, or summarization. ACP-compliant agents handle context internally (e.g., Claude Code's SDK auto-compacts when the context window fills up mid-turn). If the user wants periodic summaries, they put it in the task prompt. The platform provides the primitive ("resume this session, send this prompt") and stays out of the way.

The trigger-watcher must allow the agent process to shut down **gracefully** after prompt completion (not a hard `kill()`). The agent needs time to flush the session state — including any compaction that happened during the turn — to disk. The current implementation calls `session.kill()` immediately, which risks losing the persisted state. This should be changed to a graceful shutdown (e.g., close stdin and wait for the process to exit, with a timeout before hard kill).

The exact behavior when context is compacted — what is preserved, what is summarized, how it affects agent behavior in long-running scheduled sessions — is not fully understood yet and will be investigated separately.

If a session becomes too large for the agent to handle, the prompt fails, the schedule status records the error, and the user can decide to reset (delete the session, let the next tick create a fresh one).

### Harness agnosticism

The entire mechanism uses standard ACP protocol methods:

- `session/new` — create a session
- `session/resume` — load a persisted session into a new process
- `session/prompt` — send a prompt
- `session/list` — list sessions (for DB enrichment)

No harness-specific `_meta` fields, no Claude Code options, no capability gates. Platform already requires ACP compliance as its agent contract — `session/resume` is a core ACP method, not an extension. Any ACP-compliant agent that persists sessions works.

## Alternatives Considered

**Long-lived ACP process per schedule.** Keep the agent process alive between trigger fires to avoid resume overhead. Rejected: adds process lifecycle management complexity, doesn't survive pod restarts anyway, and fights the existing spawn-per-connection model. Session persistence already solves the problem.

**Platform-managed session storage.** Store conversation transcripts in PostgreSQL and replay them into fresh sessions. Rejected: duplicates what ACP already does, couples the platform to message format internals, and makes the platform opinionated about context management.

**Deterministic session IDs (e.g., `schedule:{name}`).** Derive session IDs from schedule names instead of storing them. Rejected: ACP session IDs are UUIDs generated by the agent; forcing a different format breaks the protocol contract. Storing the ID in the DB is simpler and protocol-compliant.

**Platform-side context compaction.** Summarize old messages, enforce sliding windows, or rotate sessions after N turns. Rejected: makes the platform opinionated about context management. Different agents handle this differently. The platform should provide primitives, not policies.

**Platform-managed context depth.** Expose a `contextDepth` option on continuous schedules to limit how many recent messages the agent sees on each tick. Investigation revealed this cannot be done agent-agnostically through ACP: during `session/resume`, the agent subprocess reads the full JSONL transcript directly from disk (e.g., `~/.claude/projects/<cwd>/<sessionId>.jsonl`) and sends it to the model API internally — the conversation history never flows over the ACP wire, so there is no interception point at the proxy level. The only viable approach would be direct JSONL file manipulation (truncate before resume, restore after), which is harness-specific, fragile, and violates the principle that the platform stays out of context management. Deferred until ACP exposes a protocol-level mechanism for context windowing.

**Graceful degradation for agents without `session/resume`.** Fall back to `session/new` if the agent doesn't support session persistence, so minimal ACP agents still work. Rejected: Platform already requires full ACP compliance as its agent contract. Adding a fallback path complicates the trigger-watcher with branching logic for a scenario that shouldn't occur. If an agent doesn't support `session/resume`, it's not a supported Platform agent.

**Pod-local result files for session ID tracking.** Store the schedule-to-session mapping as files inside the agent pod (`/workspace/.trigger-results/`), exposed via a tRPC endpoint on the agent-runtime-api. Rejected: ADR-017 already established the `sessions` table as the source of truth for session metadata. Duplicating this into pod-local files creates a parallel tracking system and doesn't survive PVC deletion gracefully. The DB is the right place.

## Consequences

- Schedule sessions retain full conversation history across triggers — agents can learn and adapt over time
- Users can interact with schedule sessions directly in the UI — they're normal sessions
- UI session list stays clean; schedule sessions are discoverable under the schedules tab
- Builds directly on ADR-017's DB-backed session model — new session types, same infrastructure
- Trigger-watcher becomes a sessions API client — reads and writes sessions through the API server like any other consumer
- Agent-runtime needs network access to the API server (already the case for other functionality)
- Trigger files are deleted on completion (not before) — changes ADR-008's fire-and-forget model to at-least-once delivery
- Triggers are serialized within a schedule (concurrent across schedules)
- Controller is unchanged — still writes trigger files, doesn't need to know about session IDs
- Context growth is delegated to the agent — the platform doesn't intervene
- `session/resume` support is a hard requirement for Platform agents — this is reasonable given ACP compliance is already required
