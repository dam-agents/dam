# ADR-021: Slack outbound messaging — MCP tool

**Date:** 2026-04-16
**Status:** Accepted
**Owner:** @tomkis

## Context

ADR-018 established Slack integration as inbound-only: users mention `@Platform` in Slack, messages route to agent instances, responses flow back in-thread. Agents have no way to initiate messages to Slack.

Agents need to post proactively — scheduled job results, status updates, and other agent-initiated communication.

## Decision

### 1. Single delivery mode — MCP tool

```
send_slack_message(text: string) → { ok: true } | { error: string }
```

The agent explicitly decides what and when to post. Same mechanism for both interactive and scheduled sessions.

Flow: harness → MCP tool → API Server → SlackWorker → Slack.

**MCP endpoint** hosted on a dedicated port (separate from the admin API) at `/api/instances/:id/mcp` using Streamable HTTP transport. Direct access to SlackWorker — no agent-runtime round-trip.

**Auth:** Caller identity is derived from the source pod IP, mapped to a `platform.ai/instance` label via the api-server's `podIpResolver` cache. The agent presents no Bearer token. NetworkPolicy on the api-server pod admits the harness port only from agent pods, so the kernel-verified source IP is the source of truth — a compromised harness can't claim to be a different instance. Owner match (agent.owner == instance.owner) is the second check.

**Network isolation:** The MCP port is the only API server port allowed by the agent's NetworkPolicy — agents cannot reach the admin API (tRPC, OAuth, etc.).

- Tool **always registered**; calls rejected at invocation time when no channel connected
- Returns errors from Slack (bot removed, invalid channel) — harness handles
- Messages posted as plain text with instance name in a context block

### 2. Bidirectional channel

Channel becomes bidirectional at the instance level. When an instance has a connected channel, all sessions (interactive and scheduled) can use it for both inbound and outbound. No per-session outbound flag — if the channel is connected, `send_slack_message` works.

### 3. Fire-and-forget threading model

- Outbound message → top-level post in channel → no thread-to-session mapping stored
- User replies with `@Platform` in the resulting thread → treated as a **new inbound mention** → creates a new session
- Context from the originating session is not carried over (acceptable trade-off for simplicity)

## Alternatives Considered

**Two delivery modes (MCP tool + platform capture).** Scheduled sessions would be channel-unaware — platform captures all output and delivers on completion. Rejected — requires output capture machinery and completion signaling that doesn't exist today. Single MCP tool approach is simpler and gives agents explicit control in both contexts.

**Thread-to-session mapping for outbound messages.** Outbound posts could store `threadTs → sessionId` so replies route back to the originating session. Rejected — adds complexity (mapping storage, stale session handling) and breaks session isolation.

**Conditional tool registration.** Only register `send_slack_message` when outbound is enabled. Rejected — always registering with call-time gating is simpler; no need to dynamically update tool lists.

**Per-session outbound flag.** Gate `send_slack_message` per session with a DB-persisted flag. Rejected — adds unnecessary granularity. Channel is an instance-level concept; if a channel is connected, all sessions should be able to post. Simplifies both the data model and UI (no session toggle, no schedule-level config).

## Consequences

**Easier:**
- Single delivery mode for all session types — less code, fewer concepts
- Bidirectional channel at instance level — no per-session or per-schedule config
- Consistent mental model: if channel is connected, agent can post

**Harder:**
- Agents must explicitly call the tool (agent prompt must include posting instructions)
- No conversational continuity between outbound posts and Slack replies (new session each time)
- No granular control over which sessions can post (all-or-nothing per instance)
