---
id: 082
title: UI live updates — thin invalidation events over tRPC WebSocket subscriptions
status: accepted
subsystem: platform-topology
tags: [ui, api-server, websocket, trpc, redis]
summary: The UI stops polling; server-side changes are announced as thin, signal-only invalidation events pushed over a per-tab tRPC WebSocket subscription, and the client re-reads the affected queries over the same dual-transport tRPC surface.
---

# ADR-082: UI live updates — thin invalidation events over tRPC WebSocket subscriptions

**Date:** 2026-08-06
**Status:** Accepted
**Owner:** @jezekra1

## Context

Fourteen UI surfaces keep themselves current by re-asking the server on 2–15 s timers (#3170) — the owner-wide approvals poll runs every 2 s from the global chrome on every screen, and the session-list poll opens a fresh passive chat socket per 5 s tick. The cost scales with open tabs rather than activity, every interval trades staleness against load, and pushed and polled state coexist with no rule for which one a new screen should use. A push path exists but is partial: approvals events already fan out over Redis to attached chat sockets — where the UI discards them — and chat sockets exist only on session views.

## Decision

The UI stops polling. Every server-side change the UI displays is announced by a **thin invalidation event** — a topic plus entity ids, never entity state — pushed over a single per-tab WebSocket carrying tRPC subscriptions, and the client responds by re-reading the affected queries through the normal tRPC read path. Polling is removed outright rather than kept as a fallback: the socket is the sole freshness mechanism, a lost connection is surfaced as visible degradation, and every subscription opens with a sync event on (re)subscribe so reconnection heals by refetch instead of replay.

Boundaries of the decision:

- **Signal-only.** The socket never carries state; truth stays in the stores (Postgres, the K8s API, agent pods) and is re-read on demand — the same contract the existing Redis bus documents. Redis pub/sub is the cross-replica fan-out. Events are idempotent and unordered; there is no replay or ordering machinery. Promoting any topic to a state-carrying payload is a new decision.
- **Dual transport, one contract.** The same tRPC router is served over HTTP and the WebSocket; each client picks its links (the browser starts with subscriptions on the socket and queries/mutations on HTTP; the CLI stays on HTTP). Every cross-cutting gate — terms acceptance, scopes — must therefore be enforced at the tRPC layer, not the HTTP layer, or the socket path bypasses it.
- **Token-bounded connections.** The access token rides the socket's first frame, not the URL. A connection never outlives its token: before expiry the server nudges the client with the protocol's reconnect notification and the client reconnects carrying a freshly refreshed token, re-running all connect-time checks.
- **Subscriptions are passive reads.** Holding the socket or a per-agent topic neither wakes a hibernated agent nor keeps a running one warm, preserving hard-stop stickiness and the passive-read invariant of the session-list path.
- How each domain's writes come to emit events (Postgres write sites, a K8s watch, pod-side sources) is per-subsystem design work, out of scope here.

## Alternatives Considered

- **SSE (tRPC HTTP subscriptions)** — one fixed-scope stream per subscription: per-view topics multiply streams into the browser's 6-per-host HTTP/1.1 budget (dev and non-TLS installs), and every scope change is a stream teardown; the WS path is already proven through this deployment's ingress by three relays.
- **Extending the chat (ACP) socket** — per-agent and open only on session views; the hottest polls (owner-wide approvals badge, sandbox list) live on screens that hold no socket, and its lifecycle is deliberately parked while an agent isn't operable.
- **A bespoke events WebSocket** — a second hand-versioned wire protocol beside the typed tRPC surface; the tRPC adapter already provides framing, keepalive, reconnect-with-resubscribe, and end-to-end types.
- **Fat events (state payloads)** — every write site must assemble each consumer's read-model shape, clients need per-query cache-patch logic, and correctness demands per-topic ordering plus replay on reconnect; the saved round-trip is one message-pair on an open socket, against polls that run at 2–5 s today.
- **Polling kept as a fallback** — two freshness mechanisms for one job is the state the issue exists to end; degraded mode is visible staleness plus automatic reconnect, not a second mechanism.

## Consequences

- **Easier:** an idle tab generates no recurring traffic, where a chat view today sustains ~10 requests per 5 s across api-server, K8s API, and agent pods; change latency drops from a poll interval to push-plus-refetch; multi-replica delivery is correct by construction because signals ride Redis and reads hit the store — the pattern the approvals inject channel already runs; moving the browser fully onto the socket later is a client link-config change, since the server serves both transports from day one.
- **Harder:** subscription traffic leaves HTTP observability — no per-request ingress access logs, and per-procedure tracing moves into tRPC middleware; transport parity becomes a standing obligation — every future gate added at the HTTP layer alone is a hole on the socket path; a deploy drops every socket at once, so rolling restarts need a drain nudge and the reconnect surge lands on surviving replicas.
- **Committed-to:** the signal-only contract — screens model freshness as invalidate-and-re-read; connection lifetime bounded by token lifetime, with rotation via nudged reconnect; Redis pub/sub as the install-wide event fan-out; the tRPC subscription surface in the shared contract package as the one push channel new screens use.
