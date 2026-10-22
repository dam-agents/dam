---
id: 118
title: A viewer's relayed call carries a token only the share page holds
status: accepted
supersedes:
subsystem: artifact-library
tags: [artifacts, sharing, csrf]
summary: The share page gets a token bound to the viewer, their share sign-in, the artifact and its version, and sends it with every relayed call; the relay routes refuse a call without a matching one, whatever its cookie and origin, and the origin check stays as a second layer.
---

# ADR-118: A viewer's relayed call carries a token only the share page holds

**Date:** 2026-10-22
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-116

## Context

ADR-116 lets viewers of a restricted interactive artifact reach the owner's Agent through two relay routes on the share host, authorized by the viewer's share sign-in cookie ([#5706](https://github.com/dam-agents/dam/issues/5706)).
The content host, where every artifact's code runs, is on the same site as the share host, so the browser sends that cookie with a call any artifact forges.
One server check of the call's origin was all that refused such a call: were it skipped or loosened, any artifact a listed viewer opens could read and change the owner's Agent data and send it prompts as that viewer.

## Decision

A relayed call is accepted only with a token that the share page the viewer opened holds, whatever its cookie and headers say.

- Rendering the share page of a restricted interactive artifact mints a random token, bound to the viewer, their share sign-in, the artifact and its version, and writes it into the page's relay, which sends it as a bearer credential on both routes.
- Both routes refuse a call without a token, or with one minted for another viewer, sign-in, artifact or version, and the security log records the refusal; the origin and viewer-list checks stay as further layers.
- The token lives as long as a share sign-in, so a page left open keeps working; a reload mints a fresh one, and signing out or publishing a new version makes the old one useless.

## Consequences

- **Easier:** a forged call that carries the viewer's real cookie and the share origin is still refused, so the origin check is no longer the only guard.
- **Harder:** a share page opened before a new version stops reaching the Agent until the viewer reloads it, as its frame already shows the old version.
- **Harder:** every share page render of a restricted interactive artifact writes one more short-lived record to the shared store.
- **Committed-to:** the token never reaches the artifact frame; the frame has an opaque origin and only the share page's own script holds the token.

## Alternatives Considered

- **Keep the origin check alone (ADR-116)** — one skipped or loosened check opens the owner's Agent to any artifact a viewer opens.
- **A separate content domain** — removes the shared site, but needs a new domain and certificate in every install; out of scope here.
- **A token in the frame** — puts a credential into artifact code, the code this guard is against.
