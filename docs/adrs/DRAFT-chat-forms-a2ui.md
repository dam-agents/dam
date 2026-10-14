---
title: Chat forms — agents write A2UI v1.0 into their replies
status: proposed
subsystem: chat-forms
tags: [ui, chat, a2ui, starter-kits]
summary: Agents put interactive UI into the web chat as A2UI v1.0 blocks in their reply text, rendered with the app's own components behind the experimental chat-forms flag; the chat answers in A2UI renderer messages inside the user's next prompt.
---

# ADR: Chat forms — agents write A2UI v1.0 into their replies

**Date:** 2026-10-12
**Status:** Proposed
**Owner:** @xjacka

## Context

Kit onboarding and Kit Update ask the user for structured input — which upstream changes to take, values only they know — and today that happens in free text.
The agent cannot show choices, and the user cannot answer in one click.
Three open specifications describe agent-generated UI: A2UI (declarative JSON against a component catalog), Open-JSON-UI and MCP Apps (HTML in a sandboxed iframe, delivered through MCP).

## Decision

Agents put interactive UI into the web chat by writing **A2UI v1.0** blocks into their reply text; the UI renders each block with the app's own components, and the user's answer travels back as A2UI renderer messages inside their next prompt.
The capability is an experimental feature, off by default.

- **Spec and catalogs.** A2UI v1.0 with its basic catalog and a platform catalog that adds a few app components.
  Agents never send code or HTML; anything outside the catalogs is refused and reported.
- **Transport is the conversation itself.** No dedicated MCP tool: agents learn the format from a platform skill, and the chat parses blocks out of the reply as it streams.
  The renderer's actions, errors, function results and data models go back as text the agent reads in the next turn.
- **Capabilities say where forms work.** The web chat announces the renderer's catalogs on every prompt, and the platform adds the same announcement to onboarding and Kit Update briefings, only while the owner has the feature on.
  Channel turns never carry it, so agents answer Slack and Telegram in plain text.
- **Surfaces live for the whole session.** Blocks replay in order, so a later reply updates or deletes a surface in place; only the surface the newest finished reply touched accepts input.
- **Every agent function call is answered.** The chat replies on its own, and stops after three automatic replies in a row until a person writes.
- **Catalog functions come from the official renderer core** where it implements v1.0.
  The chat keeps its own code only where the core lags the spec or is looser than it.

## Alternatives Considered

- **MCP Apps** — the harness, not the UI, is the MCP client, and every form would be an iframe styled apart from the app.
- **Open-JSON-UI** — no first-party specification, versioning or conformance suite.
- **A platform MCP tool that carries the UI** — validates before render, but adds a tool to every agent's context, where the skill loads only when used.
- **The official React renderer** — renders its own components rather than the app's.
- **Always on** — would ship a pre-release surface to every user, against the experimental-feature convention.

## Consequences

- **Easier:** any harness can produce forms: all of them already stream reply text through ACP to the chat, and none needed changes.
- **Easier:** a form survives reload and replay: it lives in the Session Transcript and the chat rebuilds its state from the transcript.
- **Harder:** a malformed block is found only when it renders.
  The agent learns of it only if the user sends the error back; the first live test produced a v0.9 block that rendered as text.
- **Harder:** A2UI v1.0 is a release candidate; its wire format changed on 2026-10-02 (the `@path`/`@call` keys), and the only core release that reads it needed an exception to the seven-day release-age floor.
- **Harder:** the text transport is not A2A, MCP or AG-UI, so another A2UI renderer cannot read these conversations without an adapter.
- **Committed-to:** the block tags agents write and read, the platform catalog identifier, and the three-reply cap on automatic function replies.
