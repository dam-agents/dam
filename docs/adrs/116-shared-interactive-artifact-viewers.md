---
id: 116
title: Viewers of a shared interactive artifact act under the owner's Agent
status: accepted
supersedes:
subsystem: artifact-library
tags: [artifacts, sharing, postmessage]
summary: People an owner shares an interactive artifact with use it as the owner does; the share host relays their requests to the Agent's Artifact API server and their prompts to a Session of their own, under the owner's grant, and the Share dialog warns the owner first.
---

# ADR-116: Viewers of a shared interactive artifact act under the owner's Agent

**Date:** 2026-10-21
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-113

## Context

ADR-113 let an owner share an interactive artifact with named viewers, but refused every request and prompt from the shared copy, and left open under whose authority a viewer may make the Agent act ([#5655](https://github.com/dam-agents/dam/issues/5655)).
A page that reads its content from its Agent, such as a live dashboard, showed viewers only an error and a stale snapshot.
A shared Slack channel already lets anyone in it make the Agent act, under the owner's grant.

## Decision

Viewers of a restricted interactive artifact act under the owner's Agent, as people in a shared Slack channel do; the owner accepts that in the Share dialog, which warns them before they share.
This amends ADR-113 for viewers only: public stays refused, and the owner's own callbacks are unchanged.

- The share host relays a viewer's calls, and checks on every call that the viewer is on the viewer list and that the artifact is still interactive, restricted, published by an Agent and has its feature on.
- A request wakes the Agent and reaches its Artifact API server, every method, as the owner's does.
- A prompt goes to the viewer's own Session on the Agent, one per viewer and artifact, named after the viewer, so the owner sees who asked for what; the turn is unattended, like a channel turn.
- Every call is in the security log under the viewer's identity, with the artifact and the owner.

## Alternatives Considered

- **Keep viewers refused (ADR-113)** — a shared live page stays useless to everyone but its owner.
- **Viewers' prompts into the owner's open chat** — mixes other people's prompts into the owner's own conversation, and a viewer has no chat of their own.
- **Viewers act under their own identity** — they hold no grant on the owner's Agent; it needs per-viewer permissions, out of scope.
- **Allow public too** — anyone with the link could make the Agent act, with no sign-in in front of it.

## Consequences

- **Easier:** a live dashboard the owner shares stays current for its viewers, and its buttons work for them.
- **Harder:** anyone on the viewer list can change the Agent's data and start turns on the owner's spend; the only control is the list itself, the feature switch and the page's own code.
- **Harder:** a viewer's turn is unattended, so a tool call that asks for permission is refused, as on a channel turn.
- **Committed-to:** the share host has relay routes that reach an Agent; their checks, not the page's bridge, are the boundary, and the share session must never be usable from the content host.
