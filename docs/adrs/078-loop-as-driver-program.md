---
id: 078
title: A loop is a driver program over the spawn primitive, not a platform conductor
status: accepted
subsystem: experiments
tags: [loops, sandboxes, dbtl, skills, sdk]
summary: A multi-step loop is an ordinary program a driver Agent runs against the spawn primitive; the platform owns the primitive and the agent owns the orchestration.
---

# ADR-078: A loop is a driver program over the spawn primitive, not a platform conductor

**Date:** 2026-07-20
**Status:** Accepted
**Owner:** @tomkis

## Context

With the spawn primitive (ADR-077) a driver Agent can create sandboxes on demand. The remaining question is where a multi-step loop's control flow lives: in the platform, as a conductor or DAG engine that sequences nodes, or in the agent. The experiments architecture to date framed orchestration as platform-owned and stated the platform does not loop, so introducing loops forces the choice now.

## Decision

A multi-step loop — a candidate carried through Design, Build, Test, and Learn across generations until it passes or a cap is hit — is an **ordinary program the driver Agent runs against the spawn primitive**. The platform owns the primitive; the agent owns the orchestration. Its rules:

- **The loop is human-reviewable code the agent generates, not a platform config.** A skill turns a goal into a readable workflow script in the driver's workspace; a human reviews it and runs it later. The skill writes the script, it does not run it — a loop spawns real, billable sandboxes, so a person sees every generation before the first spawn.
- **The spawn primitives ship as a zero-dependency SDK dropped into the workspace by a skill**, not an npm dependency or a set of platform MCP tools. The SDK travels with the workspace and needs no install.
- **Each step is one sandbox; what it does lives entirely in its prompt.** Make produces a candidate, Test gates it objectively, Eval judges it, Curate distils knowledge. Selection between candidates is plain code in the script, not a sandbox.
- **Exactly two things cross a generation boundary:** the candidate, as a durable git ref pushed through a connection, and a knowledge string threaded round to round in the script. Anything a step leaves only on its sandbox filesystem is discarded, because every node is a fresh sandbox.

## Alternatives Considered

- **Platform-side conductor / DAG engine** — the platform would sequence nodes; rejected because it hardcodes one control-flow shape behind a deploy, whereas a generated script is reviewable and editable per goal.
- **SDK as an npm dependency or platform MCP tools** — version-locks the loop to a published package or couples every step to the platform tool surface; a zero-dep skill-delivered SDK avoids both.
- **Auto-run the generated loop** — rejected: a loop consumes real compute and credentials, so a human reviews the script before any sandbox runs.

## Consequences

- **Easier:** a new loop shape is a new script, not a platform change; the entire control flow is one file a person reads top to bottom before anything spawns.
- **Harder:** loop correctness — retries, budget caps, generation limits — is the script author's responsibility, not enforced by the platform; a wedged step is caught only by the sandbox liveness deadline (ADR-077), not by a conductor supervising the run.
- **Committed-to:** the durable-across-generations contract is exactly candidate-git-ref plus knowledge-string. Steps must push durable output through a connection and must not assume their filesystem survives.
- **Reconciles:** this changes the experiments architecture's "the platform does not loop" stance to "loops exist, as driver-owned programs over the spawn primitive"; `docs/architecture/experiments.md` must be updated to match.
