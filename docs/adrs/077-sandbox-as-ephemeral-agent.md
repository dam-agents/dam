---
id: 077
title: The spawn primitive is an ephemeral Agent; lifecycle and result contract are separate concerns
status: accepted
subsystem: agent-lifecycle
tags: [invocations, spawn, agent-sweep, sweepable, ext-authz, connections]
summary: A spawnable node is a normal ephemeral Agent a driver creates, prompts once, and polls; its autosweep lifecycle lives on the Agent (Sweepable + Agent Sweep) and its run-once result contract lives in a separate Invocations context.
---

# ADR-077: The spawn primitive is an ephemeral Agent; lifecycle and result contract are separate concerns

**Date:** 2026-07-20
**Status:** Accepted
**Owner:** @tomkis

## Context

We want one platform primitive: spawn an ephemeral node with a chosen image and a subset of my connections, hand it a prompt, run an agent in it, and get back a schema-validated result. That primitive lets a multi-step loop be an ordinary program that calls it instead of a hardcoded platform conductor. Two questions had to be answered together: how to model the spawnable unit, and where its lifecycle lives.

The first cut called the unit a "Sandbox" and bundled three things under that one word: a fresh ephemeral agent, an autosweep lifecycle, and a run-once typed result. It shipped them as a single `sandboxes` module with its own table and a dedicated sweeper. But "Sandbox" already binds to the user-facing name for an Agent (#892), and bundling proved wrong: the three concerns are orthogonal. An inherited agent (post-Slack-message) wants ephemerality + autosweep but no result contract; a Fork wants ephemeral + run-once with free-form output. A separate concept with its own table and sweeper gives those future cases nothing to reuse.

## Decision

The spawnable unit is a **normal ephemeral Agent** a driver Agent creates, hands one prompt, and polls to a result. There is no Sandbox resource, no Sandbox reconciler, and no fork of the driver — the whole feature is api-server TypeScript over the existing Agent primitive. The bundled "Sandbox" is unbundled into two independent concerns:

- **Lifecycle lives on the Agent.** A `Sweepable` flag (an api-server-written annotation — Radek's "annotation that marks an agent sweepable") marks an ephemeral agent for automatic deletion. A generic **Agent Sweep** deletes a Sweepable agent once it hibernates, after an optional per-agent **Agent Lifetime** grace (default zero — deleted as soon as it hibernates). The Sweep keys off Agent state alone, never any table, so every future ephemeral agent (Forks, inherited channel agents) reuses it. api-server-only: deleting the Agent ConfigMap cascades pod/gateway/PVC via ownerReferences — no controller change.
- **The result contract lives in a separate Invocations context** (see the glossary's Invocations section). An Invocation is a `(driver, target, prompt, result schema) → one validated result` record. It owns the per-result liveness deadline (which bounds one result, not the agent), the stashed JSON Schema, and the fixed `report_result` tool. It does not own autosweep. The common case pairs an Invocation with a freshly-spawned Sweepable Agent, but that pairing is not part of the definition.

Its cross-cutting rules:

- **Attenuation.** A target's requested connections must be a subset of the driver's own grants; a superset is rejected at spawn. The connection fan-out (egress rules plus credential injection) then materializes under the target's own identity, so it is genuinely attenuated, never able to exceed the driver.
- **The platform stays blind to content.** The prompt and the result JSON Schema live only in the durable Invocation record, never on any Kubernetes resource.
- **The result is validated for shape, never for truth.** The target reports through `report_result`, which validates against the driver-supplied JSON Schema; a pass asserts the result has the agreed shape, never that it is correct. A failure returns the validation errors so the agent retries.
- **The one-shot prompt rides the existing trigger rail** in a fresh session, rather than a dedicated event kind.
- **Reaping is eager, with the Sweep as backstop.** A terminal Invocation (done *or* failed) deletes its target eagerly via `agents.delete`; the Agent Sweep catches any Sweepable agent an Invocation did not reap (a failed eager delete, a dead replica, or a future Sweepable agent with no Invocation). The Invocation result row outlives the Agent for a short retention window so a slightly late poll reads the result rather than a 404.

## Alternatives Considered

- **New Sandbox CRD + reconciler** — duplicates controller, codegen, gateway, service-account, and network-policy surface the Agent primitive already provides; the reuse path is all TypeScript with none of it.
- **Fork of the driver (injection-only)** — a bespoke id fails the fail-closed ext-authz identity gate, forcing a "borrow the driver's identity" hack; it cannot own its own MCP endpoint, so result attribution across concurrent targets is ambiguous; and it yields only an injected credential subset, not real per-target egress attenuation.
- **Keep the bundled "Sandbox" module** (fresh agent + autosweep + result contract in one table with one sweeper) — rejected because the three concerns are orthogonal and the bundle gives future ephemeral agents (Forks, inherited channel agents) nothing to hook into; the split lets them reuse `Sweepable` + the Agent Sweep without a result contract.

## Consequences

- **Easier:** no new CRD, reconciler, codegen, or policy surface. Because a target is a real Agent, three hard problems solve themselves — it resolves natively in the ext-authz identity resolver, it owns its own `/api/agents/<id>/mcp` endpoint so results attribute unambiguously by its own id, and it gets the real connection fan-out under that id. Autosweep is now a generic Agent capability, so Forks and inherited channel agents can adopt it without new machinery.
- **Harder:** each target is a full StatefulSet plus PVC, heavier than a fork or injection-only path would be; targets show up in the owner's agent list; and garbage collection is the platform's own concern (the Agent Sweep) rather than a resource's ownerReferences.
- **Committed-to:** the liveness deadline is load-bearing — without it, a target that exits without reporting would wedge the driver's poll loop forever. The Agent Sweep keying off Agent state (never the Invocations table) is the invariant that lets the future Fork/inherited-agent migration hook in; if it ever reads the Invocations table it is just the old sweeper renamed. The durable Invocation record, not any Kubernetes object, is the source of truth for a target's outcome.
