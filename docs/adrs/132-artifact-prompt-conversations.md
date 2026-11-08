---
id: 132
title: An interactive page may split its caller's own Sessions by conversation
status: accepted
supersedes:
subsystem: artifact-library
tags: [artifacts, postmessage, sessions]
summary: A page's prompt may name a conversation, and each conversation of one caller on one page gets a Session of its own; the name only splits that caller's own Sessions for that page and grants no new destination.
---

# ADR-132: An interactive page may split its caller's own Sessions by conversation

**Date:** 2026-11-08
**Status:** Accepted
**Owner:** @xjacka
**Amends:** ADR-092, ADR-128

## Context

Under ADR-116 and ADR-128 every prompt from one person on one interactive page goes to one Session, keyed by the page and that person.
A page that a whole team uses for many separate conversations, such as a design desk with one thread per request, therefore runs every conversation of one person in a single Session.
That Session grows without end and mixes unrelated work, so the Agent carries one thread's context into the next.

## Decision

A page's prompt may name a conversation, a short plain key the page chooses, and each conversation of one caller on one page gets a Session of its own.
A later prompt with the same key continues that Session; a prompt without a key keeps the one Session it had before.

- The key only splits the caller's own Sessions for that page: the Session is still found by the page and the caller, and the key is added after them.
  It grants no new destination: artifact code still cannot reach another person's Session, a chat, or a Session outside its own page and caller.
- A key is at most 64 letters, digits, dots, colons, underscores or hyphens; the bridge and the server refuse any other.
- A prompt with a key always wants a Session of its own: for the owner it goes to their own Session for that conversation even in the publishing Agent's docked chat, where a plain prompt goes to the open chat.
- The Session title ends with the key, so the owner tells the conversations apart in the session list.
- The security log records the key with the prompt's other metadata, never the prompt text.

## Consequences

- **Easier:** one team page holds many conversations per person, each with its own context, and the Agent no longer reads one thread's history into another.
- **Harder:** a page that names a new key for every click opens a new Session every time, so the owner's session list grows with the page's conversations.
- **Harder:** the owner's prompt with a key runs unattended even beside the chat, so a tool call that asks for permission is refused, as on a channel turn.
- **Committed-to:** the host, not the page, still decides whose Sessions a prompt may reach; the key narrows that choice and never widens it.

## Alternatives Considered

- **Let the page name a Session by id** — gives artifact code the destination authority ADR-092 withholds.
- **A new Session on every prompt** — loses the thread's context on the next click.
- **One page per conversation** — a team page cannot publish and share a new artifact per thread.
