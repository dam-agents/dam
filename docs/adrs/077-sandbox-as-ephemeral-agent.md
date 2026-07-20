---
id: 077
title: Sandbox is an ephemeral Agent, not a Sandbox CRD or a Fork
status: accepted
subsystem: agent-lifecycle
tags: [sandboxes, spawn, ext-authz, connections]
summary: A spawnable sandbox is a normal ephemeral Agent a driver creates, prompts once, and polls, reusing the Agent primitive rather than a new Sandbox CRD or a fork of the driver.
---

# ADR-077: Sandbox is an ephemeral Agent, not a Sandbox CRD or a Fork

**Date:** 2026-07-20
**Status:** Accepted
**Owner:** @tomkis

## Context

We want one platform primitive: spawn an ephemeral sandbox with a chosen image and a subset of my connections, hand it a prompt, run an agent in it, and get back a schema-validated result. That primitive lets a multi-step loop be an ordinary program that calls it (ADR-078) instead of a hardcoded platform conductor. The open question was how to model the spawnable unit. The first plan framed a node as a Fork of the driver and added a new Sandbox CRD plus a reconciler cloning the Fork machinery.

## Decision

A sandbox is a **normal ephemeral Agent** that a driver Agent creates, hands one prompt, and polls to a result. There is no Sandbox resource, no Sandbox reconciler, and no fork of the driver — the whole feature is API-server TypeScript over the existing Agent primitive. Its rules:

- **Attenuation.** A sandbox's requested connections must be a subset of the driver's own grants; a superset is rejected at spawn. The connection fan-out (egress rules plus credential injection) then materializes under the sandbox's own identity, so the sandbox is genuinely attenuated, never able to exceed the driver.
- **The platform stays blind to content.** The prompt and the result JSON Schema live only in the platform's durable sandbox record, never on any Kubernetes resource.
- **The result is validated for shape, never for truth.** The sandbox reports its result through a fixed tool that validates it against the driver-supplied JSON Schema; a pass asserts the result has the agreed shape, never that it is correct. A failure returns the validation errors so the agent retries.
- **The one-shot prompt rides the existing trigger rail** in a fresh session, rather than a dedicated sandbox event kind.
- **Lifecycle is platform-managed.** Each sandbox carries a liveness deadline; a sandbox that exits silently or runs past its deadline is failed. A terminal sandbox's Agent is reaped, and the result record is kept for a short retention window so a slightly late poll reads the result rather than a 404.

## Alternatives Considered

- **New Sandbox CRD + reconciler** — duplicates controller, codegen, gateway, service-account, and network-policy surface the Agent primitive already provides; the reuse path is all TypeScript with none of it.
- **Fork of the driver (injection-only)** — a bespoke sandbox id fails the fail-closed ext-authz identity gate, forcing a "borrow the driver's identity" hack; it cannot own its own MCP endpoint, so result attribution across concurrent sandboxes is ambiguous; and it yields only an injected credential subset, not real per-sandbox egress attenuation.

## Consequences

- **Easier:** no new CRD, reconciler, codegen, or policy surface. Because a sandbox is a real Agent, three hard problems solve themselves — it resolves natively in the ext-authz identity resolver, it owns its own `/api/agents/<id>/mcp` endpoint so results attribute unambiguously by the sandbox's own id, and it gets the real connection fan-out under that id.
- **Harder:** each node is a full StatefulSet plus PVC, heavier than a fork or injection-only path would be; sandboxes show up in the owner's agent list; and garbage collection is the platform's own concern rather than a resource's ownerReferences.
- **Committed-to:** the liveness-and-reap sweeper is load-bearing — without the deadline, a sandbox that exits without reporting would wedge the driver's poll loop forever. The durable sandbox record, not any Kubernetes object, is the source of truth for a sandbox's outcome.
