# ADR-018: Slack integration — Socket Mode, channel-based routing, identity linking

**Date:** 2026-04-15
**Status:** Accepted
**Owner:** @tomkis

## Context

ADR-016 established that messenger integrations are handled by the API Server via a channels abstraction. This ADR specifies the Slack-specific integration design.

Key constraints:
- The API Server runs behind a VPN — Slack cannot POST to it directly
- Multiple users share a single Slack workspace and need access to different instances
- Users must be authenticated (linked to Keycloak identity per ADR-015)
- A single Slack app serves the entire Platform installation

## Decision

### 1. Socket Mode — no public endpoint

The Slack app uses Socket Mode instead of HTTP request URLs. The API Server connects to Slack via WebSocket using an App-Level Token (`xapp-...`), receiving all events and interactions over the socket. No inbound network access required.

### 2. Identity linking via `/platform login`

A `/platform login` slash command initiates a Keycloak OAuth flow:

1. User types `/platform login`
2. Bot replies with an ephemeral message containing a Keycloak login URL
3. User clicks, authenticates via Keycloak
4. Keycloak redirects to the API Server callback (user is on VPN, so this works)
5. API Server stores `slack_user_id ↔ keycloak_identity` mapping

All subsequent interactions require a linked identity. Unlinked users receive an ephemeral prompt to `/platform login` first.

### 3. Two-tier access control — channel + instance

**Channel membership** is the coarse-grained gate — users must be in the channel and have linked their identity to see and read bot interactions.

**Per-instance allowed users** is the fine-grained gate — each instance can optionally declare a list of users who are allowed to interact with it. Users not on the list can still read the channel and see bot responses, but the bot ignores their messages (or replies with an ephemeral "no access" message).

This gives instance owners control over who can trigger agent work while keeping the channel visible to the broader team for transparency. For example, an instance owner can restrict interaction to themselves and one collaborator, while the rest of the channel observes.

### 4. Instance selection per thread

When a user sends a message in a channel:
1. Bot checks which instances the user has access to in that channel
2. If one instance → route directly, no prompt
3. If multiple → show `external_select` dropdown (lazy-loads from Platform API)
4. Selected instance is stored as a `thread_ts → instance_id` mapping
5. All subsequent messages in the thread route to the same instance

### 5. Instance context block

Each bot reply includes a Slack `context` block showing the active instance:

```
🔗 my-agent-1  ·  claude-code  ·  running
```

This keeps the instance visible without cluttering the conversation.

### 6. Session model

Inherits from ADR-016: each thread is a new ACP session. Thread history is injected as context on each message (Slack is the source of truth for conversation history, the bot remains stateless).

## Alternatives Considered

**HTTP Request URL for interactions.** Rejected: requires a public endpoint or tunnel. Socket Mode keeps everything behind VPN.

**Multiple Slack apps (one per instance).** Rejected: each app needs creation + OAuth install. Doesn't scale, workspace admins won't approve dozens of apps.

**Channel membership as sole access control.** Considered but insufficient: teams want read-only observers in the channel while restricting who can actually trigger agent work. Two-tier model (channel + per-instance allowed users) covers both cases.

**DM-based interaction with modal selector.** Rejected: DM threading gets messy with multiple instances. Channels provide natural scoping and team visibility.

**Persistent ACP sessions per thread.** Rejected per ADR-016: Slack holds the conversation history. Fetching from Slack API on each message keeps the bot stateless.

## Consequences

- Single Slack app per Platform installation — simple admin
- Socket Mode means no public endpoints, but also means max 10 concurrent WebSocket connections per app (Slack limit) — sufficient for current scale
- Identity linking is a one-time step per user; must handle token refresh/expiry
- Two-tier access: channel membership for visibility, per-instance allowed users for interaction rights
- Instance-to-channel binding must be stored somewhere (instance ConfigMap spec or DB)
- `external_select` requires an Options Load URL — with Socket Mode, this is handled over the same WebSocket
