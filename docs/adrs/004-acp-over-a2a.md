---
id: 004
title: ACP over A2A for the experiment
status: accepted
subsystem: connections
summary: Adopt Zed's ACP instead of A2A for the greenfield experiment; reconcile with A2A later if needed.
---
# ADR-004: ACP over A2A for the experiment

**Date:** 2026-04-01
**Status:** Accepted
**Owner:** @tomkis

## Context

The existing ADK/Kagenti infrastructure is built around A2A (Agent-to-Agent protocol). However, the team increasingly sees A2A as heavyweight for the harness-based agent model — multi-agent coordination is moving inside harnesses (subagent spawning) rather than through inter-service protocols. The greenfield prototype needs a communication protocol, and the team questioned whether A2A is the right choice.

ACP (from Zed) was identified as a lighter-weight alternative better suited to harness-based agents.

## Decision

Use ACP for the greenfield experiment. Figure out how to make it play nicely with A2A later (if at all).

The harness must be ACP-compliant. The gateway/proxy can use custom protocols where ACP doesn't cover the need (e.g., file syncing).

## Alternatives Considered

**A2A from the start.** Rejected for the experiment: heavyweight, adds complexity, and the team isn't convinced it's the right protocol for harness-based agents. Red Hat cares about A2A for Kagenti, but the experiment needs to move fast without that constraint.

**No protocol, fully custom.** Rejected: having a standard protocol, even a lightweight one, enables interoperability and avoids reinventing communication patterns.

## Consequences

- Prototype is unblocked from A2A constraints — can move faster
- Risk: if Red Hat requires A2A compliance, the prototype may need a compatibility layer later
- ACP may not cover all use cases (file syncing already identified as needing custom API)
- Team must eventually reconcile ACP and A2A if the prototype succeeds and ports to Kagenti
