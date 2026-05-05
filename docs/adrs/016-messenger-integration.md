# ADR-016: Messenger integration handled by API Server

**Date:** 2026-04-09
**Status:** Accepted
**Owner:** @tomkis

## Context

Platform needs to support instant messengers (starting with Slack) as conversational interfaces — when an agent instance is mentioned in a channel, it should wake up, run a session, and reply.

Key constraints:
- The agent pod can be scaled to zero after inactivity — a sidecar would die with it and miss mentions
- The bot must stay alive to listen for mentions even when the agent is hibernating
- In a multi-tenant setup, each tenant brings their own bot token

## Decision

The **API Server** handles messenger integrations directly. It already manages ACP relay connections and can wake hibernated instances — all the pieces needed. No new Deployment.

### Channels abstraction

Messenger integrations are modeled as **channels** — a pluggable adapter interface that the API Server delegates to. Each messenger type implements the same contract, so adding a new messenger requires only a new adapter.

Channel configuration lives in the instance ConfigMap spec as a polymorphic array — each entry declares its type and type-specific config (e.g. bot token for Slack).

### Token management

Messenger tokens are platform-level credentials — they are consumed by the API Server, never by the agent pod. OneCLI injection does not apply since OneCLI is a gateway for agent traffic. Tokens are stored directly in the instance ConfigMap.

### Headless ACP client

The API Server includes a headless ACP client, separate from the UI's relay. On mention it connects directly to the agent pod via WebSocket, opens a new session, sends the prompt, and collects the response. If the instance is hibernated, it wakes it first and blocks until the pod is ready.

### Session model

Each @mention creates a **new ACP session** — stateless from the ACP perspective. All context comes from the messenger API:

- **Mention in a thread** → new session, thread history injected as context
- **Mention in a channel** (no thread) → new session, recent channel messages as context

No session-to-thread mapping, no persistent state in the bot. The messenger is the source of truth for conversation history.

Messenger sessions should be hidden from the UI. ACP's `_meta` on `newSession` is not persisted by the agent runtime, so filtering by metadata alone is insufficient. This requires a server-side session registry to track channel-originated sessions.

## Prototype gaps

Channel config is stored in instance ConfigMaps, but the Controller has no role in channel lifecycle — only the API Server reads/writes this data. ConfigMaps are the wrong primitive here; PostgreSQL would be a better fit.


## Alternatives Considered

**Sidecar container in the agent pod.** Rejected: when the pod scales to zero, the bot dies and misses mentions. The bot must have an independent lifecycle.

**Dedicated messenger-gateway Deployment.** Rejected: the API Server already has everything needed (ACP relay, instance wake). A separate service adds operational overhead for no benefit.

**Deployment per instance.** Rejected: a single process can hold multiple messenger connections. Causes Deployment proliferation.

**Trigger file delivery (like cron, ADR-008).** Rejected: trigger files are fire-and-forget with no response channel. Messengers require bidirectional communication.

**Persistent session per channel/thread.** Rejected: the messenger already holds conversation history — duplicating it adds complexity. Fetching from the messenger API on each mention keeps the bot stateless.

## Consequences

- No new infrastructure — messenger handling lives in the existing API Server
- Reuses existing ACP relay and instance wake logic
- Stateless — all context sourced from messenger API, no session mapping to persist
- Pluggable — adding a new messenger requires only a new channel adapter
- API Server becomes a larger single point of failure
- Must handle reconnection and messenger rate limits
- Can be extracted into a separate service later if scale demands it
