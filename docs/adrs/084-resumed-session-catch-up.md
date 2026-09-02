---
id: 084
title: A resumed channel thread session is caught up on what it could not see
status: accepted
supersedes: 025
subsystem: channels
tags: [slack, sessions]
summary: A resuming channel thread turn carries the messages that arrived after that Agent's own last turn, best-effort, because a session's context only covers the messages that were relayed to it.
---

# ADR-084: A resumed channel thread session is caught up on what it could not see

**Date:** 2026-08-25
**Status:** Accepted
**Owner:** @tomkis

## Context

ADR-025 persists one session per thread and sends a resumed turn only the new message, on the grounds that the Agent already holds the thread's context from its prior turns. That holds only where every message in the thread reached the Agent. It does not: a binding that answers on mention is never relayed a message that does not address it, and a conversation may hold several Agents, each addressed separately. The Agent's context therefore covers the turns it was given, not the thread — and the gap between them is invisible to it, since no tool reads conversation history.

## Decision

A resuming channel thread turn also carries the thread messages that arrived after that Agent's own last turn there, attributed by author and marked as unseen. This replaces ADR-025 §5.

The catch-up is **best-effort, never a guarantee**. The unseen boundary is per (Agent, thread) and lives in the worker process that holds the thread's turn state; a restart or lease handover loses it, and the Agent's own last post in the thread stands in. Where neither can be recovered, the turn proceeds without a catch-up rather than replaying the thread.

Two boundaries follow from the messenger's read being finite. The boundary advances only as far as a read actually reached, so a burst larger than one read costs an extra turn rather than the messages. An Agent's own posts stay out, being in its context already.

A session that receives every message in its conversation needs none of this, and is excluded: reading along relays each message as its own turn, so nothing accumulates unseen.

## Alternatives Considered

- **Re-inject the whole thread on every resume** — pays the full history cost per turn and duplicates what the session already holds, which is what ADR-025 §5 set out to avoid.
- **Have the Agent fetch history itself** — a read tool over conversation history widens what a binding can reach beyond the turns it was given, and makes every turn's context depend on the Agent choosing to look.
- **Persist the boundary in Postgres** — the workers are single-holder and keep their other turn state in process; a durable boundary buys correctness only across restarts, which the own-last-post stand-in already covers.
- **Treat it as a mention-only concern** — the same gap costs a read-along Agent nothing, but scoping the rule to a binding mode would leave the boundary to be re-derived per mode.

## Consequences

- **Easier:** an Agent answering in a conversation shared with others can be held to what was already said there. Before this, the first Agent to answer in a thread saw nothing posted after its own turn — reproduced against the worker with several Agents, and with one Agent and two people talking.
- **Harder:** every resumed thread turn now costs a messenger history read, where previously it cost none. The read is anchored at the boundary, so its size tracks what was missed rather than the thread's length.
- **Harder:** the catch-up can duplicate messages the Agent has already seen — after a lost boundary, or on the turn following a burst that exceeded one read. Under-reporting loses messages permanently, so the ambiguity is resolved toward showing a message twice.
- **Committed-to:** the unseen boundary as a per-(Agent, thread) fact the worker owns. A future reader asking whether it still needs to be in-process should check whether the workers are still single-holder.
