---
id: 092
title: Interactive artifacts delegate prompts to their host chat
status: accepted
subsystem: artifact-library
tags: [artifacts, sandbox, postmessage]
summary: Inject a platform-owned API into sandboxed HTML artifacts and carry prompt requests over window.postMessage to the host's existing chat sender.
---

# ADR-092: Interactive artifacts delegate prompts to their host chat

**Date:** 2026-09-16
**Status:** Accepted
**Owner:** @tomkis

## Context

An HTML artifact needs to let its owner ask the publishing Agent to act on a button click while keeping generated code isolated from the authenticated app. The [Artifact Library](../architecture/artifact-library.md) already renders in-app previews in sandboxed iframes, and chat already owns prompt delivery, queuing, replies, and errors. This record retrospectively captures the decision implemented in [PR #3467](https://github.com/dam-agents/dam/pull/3467), which is still open when this record is written.

## Decision

Inject a platform-owned `platform.sendPrompt(text)` API when rendering interactive HTML and carry its prompt requests to the parent with `window.postMessage`. The host validates those requests and submits them through the existing sender for the open chat with the artifact's publishing Agent.

The injected API is a convenience for authors, not a trust boundary. Generated HTML can send messages itself, so the host checks the sending window against its own preview frame and validates the message and prompt. The in-app sandbox keeps an opaque origin without same-origin permission; an origin string alone cannot identify the intended frame. Artifact code receives no app credentials, direct agent connection, or authority to select a destination Agent or Session.

Injection happens when rendering, without rewriting stored artifact bytes or requiring authors to bundle the bridge. The presence of the API does not grant permission to send: the host enables callbacks only for an explicitly interactive, private HTML artifact's latest version in the publishing Agent's docked chat preview, including fullscreen, with the feature enabled and an available open chat. Library previews and historical versions have no callback. Interactivity is fixed at creation, and the server refuses sharing changes that would make such an artifact public or restricted.

The bridge is one-way. It provides neither an answer nor a delivery receipt to the page; replies and failures belong to chat, and the Agent can publish an updated artifact through the existing version flow. There is no permanent Session binding or separate artifact request lifecycle. Authoring guidance requires user-triggered prompts, but the bridge does not attest that a message came from a physical click.

## Alternatives Considered

- **Give the artifact credentials and direct API access** — would expose authenticated capabilities to generated code and require it to own delivery and destination selection.
- **Let the frame access the parent directly** — would require relaxing the origin isolation that keeps generated code away from app state.
- **Require each artifact to embed its own bridge** — would copy platform protocol details into stored content instead of supplying the author API at render time.
- **Maintain a separate request/response protocol for artifacts** — the earlier PR implementation needed durable requests, result delivery, and conversation binding; the selected scope can use the existing chat lifecycle.

## Consequences

- **Easier:** artifact authors need only the injected prompt API; no authentication setup, transport client, or bridge bundle is stored in each page.
- **Easier:** artifact prompts use the same queue, delivery handling, and visible conversation as typed prompts, without a second request store or result-delivery path.
- **Harder:** the page cannot await an agent answer or distinguish successful delivery from a disconnected callback. Standalone downloads, library previews, old versions, and shared copies cannot offer the same interaction.
- **Harder:** a valid message from the permitted frame can cause an agent turn without a verified user gesture. Frame and payload validation constrain the sender and request shape, not the intent of generated code.
- **Committed-to:** the host remains the authority for callback eligibility and chat destination; the injected shim cannot enforce either. Any future answers inside the page or shared interactive pages require an explicit extension to this contract.
