---
id: 101
title: A reclaimed agent says it was put to sleep early
status: accepted
supersedes: 081
subsystem: budgets
tags: [hibernation, admission, capacity, notifications]
summary: The platform keeps hibernating an owner's unattended idle agents early to admit a blocked start or relieve VM memory pressure, under ADR-081's rules, but a reclaimed agent now tells its owner why it is asleep instead of passing for a lapsed timeout.
---

# ADR-101: A reclaimed agent says it was put to sleep early

**Date:** 2026-10-13
**Status:** Accepted
**Owner:** @JanPokorny

## Context

ADR-081 let the per-user gate admit a blocked start by hibernating the owner's unattended idle agents early, and made that reclamation silent.
Since then, VM agents reclaim the same way when their owner's memory pool runs short, every 30 s and within seconds of pressure, so early sleep is no longer a rare edge of admission.
A user who returns to an agent that slept well before its timeout cannot tell a reclaim from a crash or a bug: a report of agents "suspending well before the hibernation timeout, with no reason shown" (#4423) is that confusion.

## Decision

Reclamation stays as ADR-081 decided — same owner only, unattended agents only, the idle floor, longest-idle first — but it is no longer silent: a reclaimed agent says it was put to sleep early, and why, until a newer activity outdates the reclaim.
The reason is "to free memory for your other agents" on the VM backend and "to make room for an agent you started" on the container backend.
The notice is shown where the user meets the agent — its unavailable view, its row, and a one-time notice when it happens while the user is looking — and is never pushed elsewhere.

The signal is the reclaim stamp the controller already writes; announcing it adds no state.

## Alternatives Considered

- **Keep it silent** — the eligibility rules hide who is affected at the moment, not afterwards; the user still meets an agent asleep for no reason they can see.
- **Message the owner on Slack for every reclaim** — a reclaim breaks nothing and is reversed by one start; a direct message for it would bury the alerts that need action.
- **A separate "reclaimed" state beside "hibernated"** — the agent behaves exactly like any sleeping agent, so a new state would fork every consumer of the state machine for a message.

## Consequences

- **Easier:** An agent that slept early explains itself in the places the user already looks, with no new controller write: the controller's existing reclaim stamp carries everything the message needs.
- **Harder:** The api-server now reads a controller annotation it never read, so a change to how the controller stamps or clears a reclaim changes what users see; the two must agree on "a newer activity outdates the stamp".
- **Committed-to:** ADR-081's admission rules unchanged, now with an announced outcome: the session pin is still what keeps an attended agent from being reclaimed, and the notice is not a substitute for that rule.
