---
id: 094
title: An Invocation is a durable delegation record that follows its driver
status: accepted
subsystem: agent-lifecycle
tags: [invocations, spawn, persistence, transcripts]
summary: The Invocation record outlives its target for the root driver's lifetime, carrying prompt, result and timings, and the target's conversation is copied onto the root driver's own volume before the target is deleted.
---

# ADR-094: An Invocation is a durable delegation record that follows its driver

**Date:** 2026-09-21
**Status:** Accepted
**Owner:** @kapetr

## Context

A driver fans work out by spawning Invocation targets (ADR-077): each target is
a throwaway Agent that runs one prompt, reports one validated result, and is
deleted the moment it idles. The platform then forgets the delegation. The
Invocation row is dropped ten minutes after it goes terminal, the target's
conversation goes with its volume, the parent-child edge is derived from the
row and dies with it, and the prompt is never stored at all. The only trace
left is the driver's own tool call whose output names the child ids.

Users asked to see what a driver delegated: the tree of children, what each
cost, what each returned, and to open a finished child to debug it (#3425).
None of that is answerable once the ten minutes pass.

## Decision

An Invocation is a **durable delegation record that lives as long as its root
driver Agent**. The record keeps what the target was given and what it
produced. The target's conversation is copied onto the root driver's own
volume before the target is deleted, next to the other files the platform
keeps there. The target itself stays a throwaway Agent, reaped eagerly as
today.

Rules:

- **Retention follows the root driver.** The root is the first non-target
  Agent up the chain; a grandchild's immediate driver is itself a throwaway.
  The record is removed with the root's other agent-scoped rows on delete, and
  by the orphan sweep that backstops that list. The copied conversation goes
  with the root's volume. No age-based sweeper, no knob.
- **The record holds the delegation, not the run.** Prompt, image, size,
  connections granted, status, error reason, result, timings, and the driver
  and root ids that place it in the tree. Spend stays in telemetry, keyed by
  the invocation id the target's gateway already stamps.
- **The conversation is a session file of the root driver.** Sessions are
  agent-owned files on the Agent's volume, so a child's conversation is kept
  where its root's own sessions are. The platform reads the target's session
  out of its pod before reaping it and hands it to the root's runtime, which
  writes it under the platform's own directory there. It is read-only history;
  it is never loaded back into a pod as a live session.
- **Capture is best effort and never wakes the root.** While a driver waits on
  its children its turn is active, so the root is up when a child reports. When
  it is not — stopped, paused, crashed, its turn cancelled, or a script that
  did not await its spawn — the capture is skipped. A target that dies without
  a readable session yields a record with no conversation, never a failed reap.

## Alternatives Considered

- **Keep the ten-minute window** — the result read it protects is the only
  consumer; every question in #3425 needs the record after the window.
- **Conversation in Postgres jsonb** — a transcript carries tool output and
  images, so rows have no size bound; Postgres holds application state, not
  blobs.
- **Conversation in object storage** — readable and writable with every pod
  down and out of the agent's reach, but it is the one place the platform
  would keep a session outside an Agent's volume, it needs its own purge on
  driver delete, and an install with no object store would capture nothing.
  The reasons for it do not hold: the delegation block is only seen in the
  driver's chat, which wakes the driver anyway, and the root is up when its
  children report. Kept as the fallback if the root turns out too often
  unreachable at capture.
- **Keep the target as a hibernated Agent instead of deleting it** — one volume
  per child kept for the driver's lifetime, agent resources that accumulate,
  and a new Agent class the sweep and the budget gate must exempt; a fan-out of
  twenty children is twenty disks.
- **Fixed retention window** — bounds storage on a busy driver but needs a
  sweeper and a knob; kept as the fallback if storage bites.

## Consequences

- **Easier:** the delegation tree, per-child cost and result are answerable
  from one owner-scoped read for as long as the driver exists. Cleanup rides
  the existing per-agent cleanup list and orphan sweep, which already fail a
  deleted driver's running Invocations, and the conversation needs no cleanup
  of its own. A runtime migration carries the conversations with the root's
  home.
- **Harder:** teardown gains a read of the target's session and a write to the
  root's pod before delete, which lengthens reaping and must tolerate either pod
  not answering. The copy sits on a volume the agent can write, so the agent
  can delete or rewrite it; the view presents it as the child's conversation
  all the same. A long-lived driver accumulates every fan-out it ever ran, so
  the copies are byte-capped and the oldest go first.
- **Committed-to:** the record, not the target, is the durable outcome of a
  delegation; anything that wants to explain a fan-out after the fact reads it.
  The copied conversation is history and stays read-only; reviving a finished
  child for follow-up questions is a separate decision that seeds a fresh
  target from the copy rather than resurrecting the old one.
