---
id: 001
title: Ephemeral containers + persistent workspace volumes
status: accepted
subsystem: agent-lifecycle
summary: Fresh container per agent invocation, with workspace and session state persisted on mounted volumes and system packages baked into the image.
---
# ADR-001: Ephemeral containers + persistent workspace volumes

**Date:** 2026-04-02
**Status:** Accepted
**Owner:** @tomkis

## Context

The team debated how agent execution environments should work. The core tension: OpenClaw's model (persistent filesystem, everything survives) gives agents a "learning over time" property but has no isolation. Claude Code's model (ephemeral sessions, clean start) is safe but loses state between runs. We need both: agents that evolve over time and environments that can't compromise each other.

## Decision

Ephemeral containers with persistent workspace volumes. Every agent invocation spawns a fresh container (destroyed after run). Workspace files (memory, skills, project files) persist via mounted volumes. Installed packages and system-level changes go in the Docker image (baked at build time), not at runtime. This is the NanoClaw model.

- One container per agent per user
- Workspace directory persists across invocations via volume mount
- Session data persists via separate volume mount
- System packages baked into Docker image (cached layers, like GitHub Actions)
- Container runs non-root

## Alternatives Considered

**Full filesystem persistence (OpenClaw model).** Snapshot entire filesystem between runs. Rejected: expensive, no isolation between sessions, root-level changes are hard to manage, poor security track record.

**Clean containers with no persistence (pure Claude Code model).** Fresh everything on each invocation. Rejected: loses the "agent that gets smarter" property. Can't accumulate memory, skills, or workspace state.

**Overlay filesystem snapshots.** Capture diffs vs. base image. Jan Pokorny exploring this as an optimization — may reduce storage overhead for workspace volumes. Not rejected, potentially complementary.

## Consequences

- Agents can accumulate workspace state (memory files, skills, project artifacts) across sessions
- Runtime package installation doesn't survive between invocations — developers must pre-bake dependencies in Docker images
- Container startup latency becomes a concern (see ADR-006)
- Mount security is critical — must block access to sensitive host paths (.ssh, .aws, credentials)
- This is proven architecture (NanoClaw ships it today)
