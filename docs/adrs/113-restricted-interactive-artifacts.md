---
id: 113
title: Interactive artifacts can be shared with named viewers, without callbacks
status: accepted
supersedes:
subsystem: artifact-library
tags: [artifacts, sharing, postmessage]
summary: An interactive artifact may be restricted to named viewers but never public; on the share host its bridge refuses every prompt and request at once, so viewers see the page and never reach the owner's Agent.
---

# ADR-113: Interactive artifacts can be shared with named viewers, without callbacks

**Date:** 2026-10-20
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-092

## Context

ADR-092 made the server refuse any sharing change that would make an interactive artifact public or restricted.
Users then had to ask their Agent for a separate static copy to show a page to their team, and keep that copy in step by hand ([#5521](https://github.com/dam-agents/dam/issues/5521)).
The block on restricted was stricter than the callback rule needed: callbacks already work only in the owner's docked chat preview, and restricted viewers must sign in.

## Decision

An interactive artifact may be private or restricted; it is never public.
This amends ADR-092 for restricted sharing only: callback eligibility, the one-way prompt bridge and the host as the authority for it stay as they are.

- The server refuses public for an interactive artifact, at creation and on every sharing change.
- Restricted is set by the owner in the app, as for every artifact; agent tools still cannot set it.
- On the share host, the renderer injects a bridge with the same API that refuses at once: a prompt throws, a request rejects as not allowed, nothing is posted to the parent, and the page shows a notice that only its owner can use its buttons.
- The owner keeps callbacks in the docked preview while the artifact is restricted, and the Artifact API serves a restricted artifact to its owner only, as before.
- Viewers see the stored HTML as it is; the platform supplies no snapshot of state the page reads from its Agent.

## Alternatives Considered

- **Keep both restricted and public blocked** — keeps the static-copy workaround and the drift it causes.
- **Allow public too** — anyone with the link would get a page built to drive an Agent, with no sign-in in front of it.
- **No bridge on the share host** — the page's own calls would throw "platform is not defined" or wait, instead of saying why.
- **Let viewers trigger the Agent** — needs its own design for whose authority a viewer acts under; out of scope.

## Consequences

- **Easier:** an owner shares the page they use, from the Share dialog, with the existing viewer allowlist and sign-in; no second artifact to keep current.
- **Easier:** a viewer's button fails at once with a visible reason; before, an Artifact API call outside the owner's preview waited 3 minutes for its timeout.
- **Harder:** a page that loads its content through the Artifact API shows viewers an empty or error state; the author has to put what viewers should see into the HTML.
- **Committed-to:** no share-host route relays a page's prompts or requests; the refusing bridge only explains the failure, and is not the boundary.
