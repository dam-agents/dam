---
id: 025
title: Persistent ACP session per Slack thread
status: accepted
subsystem: channels
summary: Persist one ACP session per Slack thread, mapped by (instanceId, threadTs) in PostgreSQL and resumed on follow-ups, with fallback to a fresh session.
---
# ADR-025: Persistent ACP session per Slack thread

**Date:** 2026-04-20
**Status:** Accepted
**Owner:** @tomkis

## Context

ADR-018 (section 6) decided that each Slack message creates a new ACP session, with thread history re-injected from the Slack API on every turn. The bot stays stateless — Slack is the source of truth for conversation history.

This breaks down in practice:
- Agent loses tool state, reasoning context, and in-flight work between messages
- Every message pays the cost of re-injecting full thread history as context
- Doesn't match the user mental model — a Slack thread feels like one conversation, but the agent treats each message as a fresh start
- Context re-injection is lossy: tool results and intermediate reasoning are not captured in Slack messages

The building blocks for session persistence already exist: `unstable_resumeSession` for ACP session resumption, PostgreSQL-backed sessions table (ADR-017), and in-memory `threadRoutes` map for thread → instance routing.

## Decision

### 1. One thread = one ACP session

The first message in a Slack thread creates a new ACP session. All subsequent messages in the same thread resume that session via `unstable_resumeSession` instead of creating a new one.

### 2. Thread-to-session mapping in PostgreSQL

Add `threadTs` (nullable text) and `updatedAt` (timestamp) columns to the existing `sessions` table with a partial unique index on `(instanceId, threadTs)` excluding NULLs. When a Slack-originated session is created, store the `thread_ts` alongside the session ID. On follow-up messages, look up the existing session by `(instanceId, threadTs)` before creating a new one. On successful resume, touch `updatedAt`.

The in-memory `threadRoutes` map continues to handle thread → instance routing but is no longer the only state. The DB is the source of truth for thread → session mapping.

### 3. Shared session in multi-user threads

A Slack thread may have multiple authorized users posting. The persistent session is shared across all participants — any user with instance access can resume it. The current Slack user identity is injected into each prompt so the agent knows who is speaking.

This mirrors the collaborative nature of Slack threads: participants already see each other's messages and bot responses. The session context (tool results, file reads, reasoning) may contain more than what's visible in Slack messages, but all participants already have instance-level access, which is the trust boundary (ADR-018 section 3).

### 4. Graceful fallback on resume failure

If `unstable_resumeSession` fails (pod restarted and PVC lost, session expired, agent runtime error), fall back to creating a new session with thread context injected from Slack API (current behavior). The old session's `threadTs` mapping is not updated — subsequent messages will attempt to resume the stale session, fail, and fall back again. This degrades to pre-feature behavior for that thread (each message gets a fresh session). A future cleanup mechanism can remove stale mappings.

This means the worst case is identical to today's behavior — no regression.

### 5. No thread history injection on resumed sessions

When resuming an existing session, send only the new user message as the prompt — the agent already has full conversation context from prior turns. Thread history injection from Slack API is only used for the fallback path (new session creation).

## Alternatives Considered

**Keep current stateless approach.** Rejected: each message loses tool state and reasoning context. Re-injection is lossy and expensive.

**Separate mapping table instead of column on sessions.** Rejected: adds complexity for a simple 1:1 relationship. A nullable column on the existing table is sufficient.

**Cache mapping in Redis.** Rejected: PostgreSQL already stores sessions, adding Redis is unnecessary infra for a simple lookup.

**Per-user sessions within a thread (`threadTs + userId` key).** Considered: isolates each user's agent context. Rejected: breaks conversational continuity in collaborative threads (User B can't reference what agent told User A), adds complexity for marginal benefit since per-instance access control already establishes the trust boundary.

**Resume by re-injecting ACP session ID from Slack message metadata.** Considered: Slack's `metadata` field on messages could carry the session ID, avoiding a DB lookup. Rejected: metadata is not visible on all message types and adds coupling to Slack's metadata API. DB lookup is simple and reliable.

## Consequences

- Agent gets true conversational continuity within a Slack thread — tool results, reasoning, and in-flight work persist across messages
- Eliminates per-message context re-injection cost on the happy path
- DB schema migration required (`threadTs`, `updatedAt` columns + partial unique index on sessions)
- Session lifetime now tied to thread activity — need a cleanup strategy for orphaned sessions (threads that go silent)
- If the agent pod's PVC is lost, session state is gone and fallback kicks in — the user sees a "fresh start" mid-thread, which is visible but not breaking
- Supersedes ADR-018 section 6 ("each thread is a new ACP session")
