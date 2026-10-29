---
id: 125
title: The Artifact API names who is using an interactive page
status: accepted
supersedes:
subsystem: artifact-library
tags: [artifacts, sharing, identity, privacy]
summary: Every request the platform relays to an Agent's Artifact API names the person using the page, owner or viewer, with their verified email, in headers only the platform sets; the page can read the same pair for display, and nothing about authority changes.
---

# ADR-125: The Artifact API names who is using an interactive page

**Date:** 2026-10-29 **Status:** Accepted **Owner:** @xjacka
**Amends:** ADR-116

## Context

Since ADR-116, people an owner shares an interactive artifact with use its page under the owner's grant.
The Agent's Artifact API server could not tell them apart: only the content type crossed to it, so every call looked the same.
A page that should keep each person's data apart, such as a survey, a sign-up sheet or per-person tasks, could not be built.
The platform already knows who calls: the owner's session in the app, and the viewer's share session on the share host, which also names the viewer to the Agent in a viewer's prompt.

## Decision

Every request the platform relays to an Agent's Artifact API names the person using the page: a role, owner or viewer, and their email when the identity provider verified it, trimmed and lowercased.
The platform sets these as request headers on the loopback hop; the page cannot set, read or forge them.
The identity tells the Agent who is calling, and grants nothing: every call still runs under the owner's grant, and any rule per person is the Agent's to enforce.
The page can ask the bridge who is using it, for display only; the host answers that without reaching the Agent.
On a share page the owner, recognised by sub as the share host lets them in, is owner, and everyone else is a viewer.

## Consequences

- **Easier:** an Agent can serve each person their own data on one shared page, without a sign-in of its own.
- **Harder:** a viewer's email now reaches the Agent's sandbox on every request, not only with a prompt; the Share dialog says so before the owner shares.
- **Harder:** an Agent Editor has no role yet, because the in-app bridge reaches only the caller's own artifacts; adding one is a new role value.
- **Committed-to:** the caller headers are part of the Artifact API contract, and the relay must never let the page supply them.

## Alternatives Considered

- **Keep the Agent blind to the caller** — per-person pages stay impossible.
- **Identity in the body or the query** — mixes platform data into a payload the Agent defines, where a page could forge it.
- **Viewers act under their own grant** — needs per-viewer permissions; still out of scope, as in ADR-116.
- **Answer the page's `whoami` from the Agent** — wakes the Agent and waits up to two minutes only to show a name.
