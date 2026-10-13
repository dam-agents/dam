---
id: 098
title: "A waking Agent's session list shows the attention record's rows, display-only"
status: accepted
supersedes:
subsystem: home-feed
tags: [sessions, home, latency]
summary: While an Agent cannot answer for its sessions, its owner's session list shows the attention record's rows for it as a provisional, display-only list, replaced by the Agent's own list when it answers; the Agent still decides which sessions exist.
---

# ADR-098: A waking Agent's session list shows the attention record's rows, display-only

**Date:** 2026-10-13 **Status:** Accepted **Owner:** @JanPokorny

## Context

Opening a hibernated Agent showed skeletons in its session list for the whole wake: 6–16 s on dam-dev for a vm Agent, against about 0.5 s for an awake one.
The pod is the only source of the list, and it cannot answer while it starts.
The attention record ([ADR-089](089-notification-record.md)) already holds, per owner, one row per session of every awake Agent: title, kind, creation and activity times.
ADR-089 kept it out of every answer about which sessions exist.

## Decision

While an Agent cannot answer for its sessions, its owner's session list shows the attention record's rows filed for that Agent, marked provisional, and replaces them with the Agent's own list the moment it answers.
The rows are display-only: nothing acts on one as proof the session exists, and opening one asks the Agent, which still decides.
The read is scoped like the feed: the caller's own rows, for an Agent the caller owns, behind the API key's agent binding.
An empty capture shows nothing provisional: absence in the record never reads as "no sessions".

## Alternatives Considered

- **Session titles in the session directory** — stores new conversation-derived data in a table kept for spend attribution, with its own retention.
- **A browser-local copy of the last list** — helps only on the same device, and keeps titles in browser storage.
- **Keep skeletons** — the wake is the most common wait on the most common path.

## Consequences

- **Easier:** time to session list for a sleeping Agent stops depending on its wake: one owner-scoped Postgres read instead of a 6–16 s wait.
- **Harder:** a provisional list can be stale — a session created or deleted after the last capture shows wrong until the Agent answers, because the record is written only while the Agent is awake.
- **Committed-to:** the attention record now also serves a display read outside Home, so dropping it costs the provisional list as well as the feed history; its rows must keep the fields a session row needs.
