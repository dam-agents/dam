---
id: 126
title: An owner's artifact prompt may open a Session of its own when no chat is docked
status: accepted
supersedes:
subsystem: artifact-library
tags: [artifacts, postmessage, sessions]
summary: Outside a chat with its publishing Agent, an interactive page's prompt that asks for it starts or continues the owner's own Session for that page, the way a viewer's prompt does; a plain prompt still goes nowhere there, and in a docked chat the open chat stays the destination.
---

# ADR-126: An owner's artifact prompt may open a Session of its own when no chat is docked

**Date:** 2026-10-30
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-092

## Context

ADR-092 sends an interactive artifact's prompts only into the publishing Agent's open chat, so an owner who opens the page from the library or anywhere outside that chat clicks buttons that do nothing ([#6111](https://github.com/dam-agents/dam/issues/6111)).
Since ADR-116, a viewer of the same page shared with them has a Session of their own on the Agent, so a viewer could do more with the page than its owner.

## Decision

Outside a chat with the publishing Agent, a prompt from the owner's interactive page that asks for a Session of its own starts or continues the owner's own Session for that page, one per owner and artifact, as a viewer's does under ADR-116.
The page opts in per prompt; a plain prompt there still goes nowhere, so a page written for ADR-092 does not start turns where it did not before.
In a docked chat with the publishing Agent the open chat stays the destination, opt-in or not, because the owner is watching it.

- The server checks the artifact on every prompt as it does for the owner's Artifact API calls: the owner's own interactive HTML page an Agent published, not public, the feature on, within an API key's agent binding.
- The prompt reaches the Agent through the same delivery as a viewer's: woken first, not woken at a spend limit, run as an unattended channel turn, and found again by its key on the next click.
- The Session is titled with the owner's verified email, else their subject, and the artifact's title; the prompt tells the Agent it came from the page outside a chat.
- Every prompt, allowed or refused, is in the security log under the owner, without the prompt text.
- Historical versions still have no callback.

## Consequences

- **Easier:** a page the owner opens from the library, a link chip or a shared folder can still make its Agent act, as it can for the owner's viewers.
- **Harder:** the owner's turn from such a page is unattended, so a tool call that asks for permission is refused, as on a channel turn; the owner reads the outcome in the Session or on the page, not in the chat they were in.
- **Harder:** an author has to opt in per prompt, so pages published before this change keep doing nothing outside a chat until they are republished.
- **Committed-to:** the bridge's prompt message carries the opt-in, and the host, not the page, decides the destination: the page can ask for a Session of its own, never name one.

## Alternatives Considered

- **Every prompt opens a Session when no chat is docked** — starts turns on the owner's spend from pages written for ADR-092 that never asked for it.
- **Open the publishing Agent's chat and send the prompt there** — navigates the owner away from where they are and drops an unsaved edit in the docked slot.
- **A second Session mechanism for owners** — duplicates the ADR-116 lifecycle and its double-click lock.
