---
id: 017
title: DB-backed ACP sessions for metadata
status: accepted
subsystem: persistence
summary: Add a PostgreSQL sessions table as the source of truth for session existence and metadata, enriched with live ACP data at query time.
---
# ADR-017: DB-backed ACP sessions for metadata

**Date:** 2026-04-14
**Status:** Accepted
**Owner:** @tomkis

## Context

Session state lives entirely inside agent pods (ACP runtime). The API server and UI had no persistent record of which sessions exist, their type (user-initiated vs channel-triggered), or when they were created. Listing sessions required opening a WebSocket to each agent pod, which is slow and fails when pods are hibernated.

## Decision

Introduce a `sessions` PostgreSQL table as the source of truth for session existence and metadata (session ID, instance ID, type, created timestamp). The API server correlates DB rows with live ACP data (title, last update) at query time. Session creation is the ACP client's responsibility — the factory accepts an `onSessionCreated` callback that persists the row. A `SessionType` enum (`regular`, `channel_slack`) discriminates user-initiated from channel-triggered sessions.

## Alternatives Considered

- **ACP-only sessions (status quo):** No DB involvement — query agent pods directly. Rejected because it requires pods to be running, is slow over WebSocket, and provides no metadata like creation time or source channel.
- **Full session replication:** Mirror all ACP session state (messages, tool calls) into the DB. Rejected as over-engineering — agents own conversation state, the platform only needs existence + metadata.

## Consequences

- Session listing works even when agent pods are hibernated (DB rows always available, ACP enrichment is best-effort).
- New migration dependency — the `sessions` table must exist before the API server can persist sessions.
- ACP client factory pattern makes session persistence composable — callers bind their own type and instance ID into the callback.
