---
id: 110
title: Runtime migration is started by an operator, never by a user or the platform
status: accepted
subsystem: vm-runtime-migration
tags: [vm, smolvm, migration, operator]
summary: A runtime migration starts only from a cluster annotation an operator writes; the Migrate button, the user-facing abort and retry, and any platform-driven batch move are removed, and the owner sees the move's phase and nothing to press.
---

# ADR-110: Runtime migration is started by an operator, never by a user or the platform

**Date:** 2026-10-20
**Status:** Accepted
**Owner:** @JanPokorny
**Amends:** ADR-093

## Context

ADR-093's transition gives an agent's move four phases, and its first two end with a button a user presses to move one of their agents.
The button, its plan, abort and retry calls were the only writers of a migration request, so every remaining agent's move waited on its owner deciding to press it, and the abort path lived in the public API where a request could be withdrawn at any moment of the copy.
The team moves the remaining agents itself, with the runner's and the pool's figures in hand, which is not a decision an owner can make from the app.

## Decision

A runtime migration is started by an operator from the cluster, and by nothing else.
The operator annotates the Agent; the api-server decides the request as it decides any move and either records the target shape or withdraws the request and says why, and the controller carries the copy out.
No user-facing control starts, aborts or retries a move, and the platform never starts one on its own.
ADR-093's phases keep their intent and lose their mechanism: the moves of phases 1 to 3 are made from outside the app, one agent at a time or in batches the team scripts, and the owner watches the phase.

## Alternatives Considered

- **Keep the button behind a flag** — the flag went with the experiment, and the button is the surface the transition has to shed either way.
- **An in-app request an operator approves** — a queue, a permission and a notification surface for a transition that ends with the container Backend's removal.
- **Platform-driven batches** — copies of a user's HOME started with nobody asking, on a load the runner's pool and the owner's other agents share.

## Consequences

- **Easier:** the move needs no product surface. The api-server's migration procedures and the UI's action, dialog and plan view are gone, and the owner's page keeps the phase badge alone.
- **Harder:** a move now needs someone with cluster access, so a stuck or failed one waits for the operator rather than its owner, and the runbook's commands are the interface.
- **Committed-to:** the request annotation as the only trigger and the phase as the only thing a user sees; a future automatic conversion would have to reintroduce the request writer this removes.
