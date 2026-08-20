---
id: 084
title: Hosted Harness — platform-owned agent loop in the api-server
status: accepted
subsystem: hosted-harness
tags: [harness, ai-sdk, event-log, acp-facade]
summary: Agents gain an immutable Harness axis (pod | hosted); a hosted agent's loop runs in the api-server over an append-only Turn Event Log in Postgres, driving the pod through a new exec surface, with an ACP facade for clients during the transition.
---

# ADR-084: Hosted Harness — platform-owned agent loop in the api-server

**Date:** 2026-08-20
**Status:** Accepted
**Owner:** @JanPokorny

## Context

Prototypes showed that owning the agentic loop — instead of wrapping vendor harnesses (Claude Code, Codex) over ACP — gives us product control over tools and prompts, first-class queryable conversation history, a smaller executor image, and isolation from harness crashes caused by runaway in-pod workloads. Adopting it wholesale would be a rewrite; we need a transition that runs both models side by side.

## Decision

Templates gain an immutable **Harness** axis: `pod` (today's in-pod vendor harness over ACP) or `hosted`. A hosted agent's agentic loop runs **inside the api-server** as a platform-owned AI SDK tool loop; its source of truth is an append-only **Turn Event Log** in Postgres; the agent pod keeps agent-runtime but is driven only through a new **exec surface** (fresh shell per call, cwd-only persistence, bounded results) plus the existing file-ops router. During the transition, all clients reach hosted sessions through an **ACP facade** in the api-server.

Boundaries of the decision:

- The axis is orthogonal to Backend and Agent Kind, set per-template, copied to the Agent at create, never converted. The controller ignores it.
- A turn is a leased job (BullMQ, per-agent job pattern) with `(turn_id, seq)` unique-constraint fencing in the event log; recovery replays the log, appends a synthetic failed tool-result for a dangling call, and auto-continues. Re-executed shell commands after a crash are accepted, not journaled against.
- LLM credentials resolve through the existing Secret Assignments, read by the api-server at turn time — an explicit widening of what the api-server may read. Spend is exported first-party by the api-server as a second trusted telemetry source.
- The pod egress model is untouched: shell-driven traffic and MCP (via an in-pod CLI MCP client) still exit through the paired gateway under egress rules and HITL. Server-side MCP or web-fetch calls that would bypass the gateway are out of scope until they carry an equivalent in-process gate.
- The facade honors the ACP contract the clients already exercise (session metadata, permission frames as a new approval origin, history replay, model picker); the hosted harness ships no capability ACP cannot express while the facade lives. The facade sunsets when a native chat surface ships — independent of how long pod harnesses live.
- Pod wake is lazy (first tool call); tool-less turns run against hibernated agents. On a budget-refused wake or user stop, the model gets one tool-less closing response stating the real reason, then the turn ends. Schedule fires start hosted turns directly in Postgres, bypassing the runtime channel.
- Context overflow is handled by append-only compaction events; the log is never rewritten and clients keep full history.
- Rollout is gated by a per-user feature flag over a dedicated hosted template.

## Alternatives Considered

- **Workflow DevKit / `@ai-sdk/workflow` for durability** — beta dependency owning its own Postgres schema and worker model; its at-least-once steps still don't solve tool re-execution, which we accept anyway.
- **ACP facade skipped, native tRPC chat surface first** — cheapest end-state but forks UI, CLI, and channels during the riskiest phase; deferred to the facade's sunset rather than rejected.
- **Minimal purpose-built executor pod** — smaller image, but forks the pod contract (runtime channel, file ops, readiness, imports) in half for the whole hybrid period.
- **Platform-owned LLM key for hosted agents** — breaks per-user attribution and forks the credential model; hosted agents reuse Secret Assignments instead.
- **Server-side MCP client in the loop** — bypasses per-agent egress rules, HITL, and gateway credential injection; MCP stays in-pod until an in-process gate exists.

## Consequences

- **Easier:** conversation history becomes queryable platform data (turn status, resumability, compaction are all reads over one table, replacing agent-owned session files reachable only through a live pod). New product capabilities stop being bounded by vendor harness releases and the ACP contract. Tool-less turns cost no compute reservation — today every turn requires a running pod pair. Hosted spend figures become first-party-trusted, closing the documented "agent can misreport" gap.
- **Harder:** the api-server becomes the harness's failure domain — every deploy interrupts every in-flight hosted turn platform-wide, which is why turn resumability is load-bearing from day one, not an optimization. The api-server now reads upstream LLM credentials it previously only wrote, widening the impact of an api-server compromise. Two session models must be kept behaviorally aligned under one ACP surface for the whole facade period.
- **Committed-to:** the Turn Event Log as append-only truth (fencing, resume, compaction, and client streams all assume no rewrite). The exec surface contract on agent-runtime. The facade's parity ceiling and its sunset being tied to the native surface, not to pod-harness retirement — dropping either quietly turns the facade into the permanent API.
