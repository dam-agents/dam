---
id: 002
title: "Memory — platform provides primitives, agents own semantics"
status: accepted
subsystem: persistence
summary: Platform provides persistent, isolated file storage; agents design their own memory formats, consolidation, and search.
---
# ADR-002: Memory — platform provides primitives, agents own semantics

**Date:** 2026-04-02
**Status:** Accepted
**Owner:** @tomkis

## Context

The team debated whether the platform should provide structured memory (embeddings, consolidation, cross-session search) or leave memory architecture to the agent developer. Lukas argued memory should be a platform differentiator. Tomas W. argued it's the agent's problem. Radek agreed conceptually but noted the platform must handle the infrastructure (where to store, how to mount, isolation).

OpenClaw, NanoClaw, and Claude Code all handle memory differently — there's no consensus pattern in the ecosystem.

## Decision

The platform provides file primitives (persistent filesystem, isolation between agents). How agents structure memory — conversation history, curated facts, self-definition files (SOUL.md), daily logs — is the agent developer's problem.

The platform is responsible for:
- Persistent workspace volumes that survive between invocations (see ADR-001)
- Isolation so one agent's memory never leaks into another's
- Mount permissions (e.g., shared global memory as read-only for non-main agents)

The platform is NOT responsible for:
- Memory consolidation or compaction
- Structured memory formats
- Cross-session search or indexing
- Memory hierarchy design

## Alternatives Considered

**Platform-level structured memory.** Embeddings, vector search, automatic consolidation. Rejected: opinionated, couples the platform to a specific memory architecture, hard to get right generically, and first-party platforms will likely ship their own memory solutions.

**No memory support at all.** Rejected: without persistent workspace volumes, agents can't accumulate state. The primitives are necessary even if the semantics aren't.

## Consequences

- The platform stays unopinionated and lightweight — consistent with the "building blocks, not a framework" positioning
- Developers must design their own memory architecture (higher bar for getting started)
- Different agents on the same platform can use completely different memory patterns
- If a dominant memory pattern emerges, the platform can add optional support later without breaking existing agents
