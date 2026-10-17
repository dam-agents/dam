---
id: 107
title: "Rename and Delete on a provisional session row wake the Agent"
status: accepted
supersedes: 099
subsystem: home-feed
tags: [sessions, home, hibernation]
summary: A sleeping or waking Agent's session list still shows the attention record's rows as a provisional preview, but Rename and Delete on such a row wake the Agent and run once it answers; the Agent still decides which sessions exist.
---

# ADR-107: Rename and Delete on a provisional session row wake the Agent

**Date:** 2026-10-16 **Status:** Accepted **Owner:** @JanPokorny

## Context

ADR-099 made the provisional session list display-only, so the sidebar disabled Rename and Delete on its rows.
On dev, users met those greyed-out items with no reason given (#5189), and the sidebar shows provisional rows under every Agent that is not open, awake or not.
The only way to act was to open the Agent first and find the session again.

## Decision

Provisional session rows stay a preview of the attention record, replaced by the Agent's own list when it answers, but their Rename and Delete actions wake the Agent and run once it answers.
The Agent still decides: the action goes to the Agent, never to the record, and a session the Agent does not know fails like any other refused action.
Delete asks for confirmation before the wake, so a cancelled Delete never wakes the Agent.
One choice runs at most once, however often it is chosen while the Agent wakes; an Agent that stops before it answers runs nothing, and the user is told.
Opening a row keeps the rule ADR-099 set: it asks the Agent.

## Alternatives Considered

- **Keep the actions disabled, with a hint** — still costs the user an open-and-find round trip for a two-click action.
- **Act on the record** — would make the record a source of truth for sessions, against ADR-089.
- **Hide the actions on provisional rows** — users cannot tell why a row has no menu.

## Consequences

- **Easier:** Rename and Delete work from any sidebar row; the #5189 report of unexplained disabled items goes away.
- **Harder:** a Delete or Rename on a sleeping Agent costs a wake, 6–16 s for a vm Agent on dam-dev (ADR-099's measurement), and keeps it awake for its idle timeout.
- **Committed-to:** the UI holds a chosen action across the wake and across the switch from the provisional list to the Agent's own list, so the action's state cannot live in either list.
