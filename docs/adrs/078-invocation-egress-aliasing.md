---
id: 078
title: Invocation egress follows the driver (Egress Aliasing)
status: accepted
subsystem: security-and-credentials
tags: [invocations, egress, hitl]
summary: The ext_authz gate resolves an Invocation target to its driver before every egress decision; the target has no egress identity of its own, and deleting a driver cascades to its targets.
---

# ADR-078: Invocation egress follows the driver (Egress Aliasing)

**Date:** 2026-07-23
**Status:** Accepted
**Owner:** @tomkis

## Context

Invocation targets were created with the default trusted egress preset regardless of the driver's posture (#2930). A permissive driver spawned more-restricted targets whose work tripped approval prompts the user had already answered; a locked-down driver spawned *wider* targets, silently bypassing the restriction. Targets are short-lived and spawned on the fly, so per-target egress management by the user is not realistic.

## Decision

An Invocation target has no egress identity of its own. The ext_authz gate resolves the calling agent to its driver — recursively for chained Invocations, up to the root non-target agent — before rule match, HITL hold, and approval write; every egress decision for target traffic is made against the driver's live rules.

Boundaries of the decision:

- **Application-layer only.** The aliasing happens inside the gate's identity resolution, never via the agent label that drives gateway credential mounting. The target keeps its own attenuated credential set; it gains the driver's network reach, not the driver's credentials.
- **Approvals are the driver's.** Prompts raised by target traffic surface as the driver's, stamped with the originating target for audit; approving permanently updates the driver's rules, so the same request never re-asks — including from a future target.
- **Driver Cascade.** Deleting a driver fails its running Invocations and eagerly reaps their targets, transitively for chains, so a target aliased to a deleted driver is structurally unreachable; one that slips through fails closed at the gate.
- Target-side egress settings are dead by construction; targets are seeded with the empty preset and are expected to disappear from the user-facing agent list (tracked separately).

## Alternatives Considered

- **Copy the driver's preset at spawn** — static: misses manual rules and later changes, and preset derivation lies once preset rows are user-edited into manual ones.
- **Union matcher (target rules first, driver fallback)** — leaves approval rows written on a soon-dead target and two places where a decision can land; full aliasing has one.
- **Label aliasing (fork-style agent label)** — the label also drives gateway credential mounting, so it would hand the target the driver's full credential set and defeat the connection attenuation spawn enforces.

## Consequences

- **Easier:** the user manages exactly one egress surface per workload — the host agent. Tightening it applies to running targets on the next request, because rules are matched per request from the database.
- **Easier:** no zombie prompts. Before the cascade, a deleted driver left targets whose every request became an inbox prompt for up to the 6h liveness ceiling.
- **Harder:** the target gains network reach to hosts of driver connections it was not granted — reach without credentials, since the gateway injects per-agent, but a wider set of dialable hosts than its own grants imply.
- **Harder:** per-target narrowing is impossible; the driver's access is both ceiling and floor. No known need today, and adding it later means revisiting this record.
- **Committed-to:** the gate's identity resolution consults the Invocations chain on every credentialed egress request — one extra lookup per request on the hot path, and the invocations table becomes load-bearing for egress policy.
