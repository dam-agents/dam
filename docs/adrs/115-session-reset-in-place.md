---
id: 115
title: A rewind cuts the session in place and resets its log
status: accepted
subsystem: sessions
tags: [sessions, rewind, harness, session-log]
summary: A harness that can cut its stored conversation does so for a rewind or a take-back, and the runtime resets the Session's log under the same id instead of adopting a forked copy; viewers are told once and reload.
---

# ADR-115: A rewind cuts the session in place and resets its log

**Date:** 2026-10-21 **Status:** Accepted **Owner:** @kapetr **Amends:** ADR-026

## Context

A rewind and a take-back fork the conversation into a new Session and delete the original, since no harness offered to cut a session short in place.
Everything the platform keys by the Session id — per-turn spend, the session's total, telemetry, the chat's URL — then shows only what came after the cut.
The Claude Agent SDK that the Claude Code image bundles can resume a session at an earlier entry under the same id; on 2026-10-20, against that SDK, a cut at the entry before a user message, saved by one empty message that starts no model turn, kept the id, dropped the turn, and held across later resumes.

## Decision

A harness that can cut its own stored conversation does so for a rewind or a take-back, and the runtime **resets** the Session: it drops the Session's log and fills it again from the harness's history, under the same id, instead of adopting a forked copy.
The runtime tells every viewer of the Session, once, that the Session was reset, and the viewers reload it.

- The image declares the cut as a provider beside its session-history provider; the cut never goes through the harness's own protocol.
- The cut drops one turn for a take-back and refuses, changing nothing, when anything else would go.
- A cut that fails refuses the rewind; it never falls back to a fork.
- A cut before the first message, a fork from a message, and a harness without the provider keep the fork.
- The reset notification is not part of the log: a viewer that loads later reads the reset log.

## Amends

- **ADR-026** — its log is append-only for the life of the Session.
  A reset now drops a Session's log and refills it while the Session goes on; a viewer's cursor into the dropped log is void, and the viewer loads again.

## Alternatives Considered

- **Fork, as before** — the new id hides the cost and telemetry of everything before the cut.
- **The cut through the adapter's per-session options** — the adapter replays those options whenever it rebuilds the session's query, which would cut again and drop newer turns, and it cannot send the empty message that saves a take-back.
- **A cut frame with a position in the log** — every viewer, cursor and queue would have to agree on that position, for an event rarer than a reload.

## Consequences

- **Easier:** the spend rows, telemetry, attention and URL of a Session survive a rewind, since all are keyed by the id the cut keeps.
- **Easier:** a reset reuses the cold-start path: the log fills from the history provider and the next prompt rehydrates the harness, as after a pod restart.
- **Harder:** every open tab of the Session reloads it once per rewind.
- **Harder:** the provider drives the bundled SDK past the adapter, so each adapter or SDK upgrade must check again that a resume at an entry keeps the id and that the drops-turn guard still refuses.
- **Committed-to:** the image-declared session-cut provider and the session-reset notification.
