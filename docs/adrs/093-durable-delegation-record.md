---
id: 093
title: An Invocation is a durable delegation record that follows its driver
status: accepted
subsystem: agent-lifecycle
tags: [invocations, spawn, persistence, object-storage, transcripts]
summary: The Invocation record outlives its target for the driver Agent's lifetime, carrying prompt, result, timings and a pointer to the target's conversation captured into object storage before the target is deleted.
---

# ADR-093: An Invocation is a durable delegation record that follows its driver

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

An Invocation is a **durable delegation record that lives as long as its driver
Agent**. The record keeps what the target was given and what it produced, and a
pointer to the target's conversation captured into object storage before the
target is deleted. The target itself stays a throwaway Agent, reaped eagerly as
today.

Rules:

- **Retention follows the driver.** The record and its captured conversation
  are removed with the driver's other agent-scoped rows on delete, and by the
  orphan sweep that backstops that list. No age-based sweeper, no knob.
- **The record holds the delegation, not the run.** Prompt, image, size,
  connections granted, status, error reason, result, timings, and the driver
  and parent ids that place it in the tree. Spend stays in telemetry, keyed by
  the invocation id the target's gateway already stamps.
- **The conversation is captured at teardown, into object storage.** The
  platform reads the target's session from its pod before reaping it and writes
  it as a blob the record points to. The blob is read-only history; it is never
  loaded back into a pod as a live session.
- **Capture is best effort.** A target that dies without a readable session
  yields a record with no conversation, never a failed reap.

## Alternatives Considered

- **Keep the ten-minute window** — the result read it protects is the only
  consumer; every question in #3425 needs the record after the window.
- **Conversation in Postgres jsonb** — a transcript carries tool output and
  images, so rows have no size bound; Postgres holds application state, not
  blobs.
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
  deleted driver's running Invocations. Object storage already outlives Agent
  deletion for library artifacts and experiment results, so the blob's
  lifetime is only a pointer question.
- **Harder:** this is the first place the platform stores a session transcript
  outside the harness's own session store. The persistence model until now held
  that sessions are agent-owned files on the PVC and are never read from
  anywhere else; a captured conversation is a second, read-only copy with its
  own renderer. Teardown gains a read of the target's session before delete,
  which lengthens reaping and must tolerate a pod that no longer answers. A
  long-lived driver accumulates every fan-out it ever ran.
- **Committed-to:** the record, not the target, is the durable outcome of a
  delegation; anything that wants to explain a fan-out after the fact reads it.
  The captured conversation is a blob and stays one; reviving a finished child
  for follow-up questions is a separate decision that seeds a fresh target from
  the blob rather than resurrecting the old one.
