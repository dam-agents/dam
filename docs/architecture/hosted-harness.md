# Hosted Harness

Last verified: 2026-08-20

## Overview

The **Harness** axis names where an Agent's agentic loop runs. A **Pod Harness** agent (the default) runs a vendor harness binary inside its pod, driven over ACP. A **Hosted Harness** agent's loop runs **inside the api-server** as a platform-owned AI SDK tool loop; the pod keeps agent-runtime but is reduced to an executor the loop drives through an **exec surface** (plus the existing in-pod file-ops and skills routers). The axis is a per-template choice, copied onto the Agent at create time as an immutable marker, orthogonal to Backend and Agent Kind. The controller ignores it entirely — pods, gateways, volumes, budgets, and lifecycle are identical for both styles; only the api-server routes on it.

The subsystem is enabled install-wide by configuring an OpenAI-compatible LLM endpoint (Helm `hostedHarness.*`); without it, hosted sessions are refused and hosted templates should not be enabled.

## Turn Event Log

A hosted session's source of truth is the **Turn Event Log** — an append-only per-session event stream in Postgres (user message, assistant message, tool call, tool result, compaction, turn end). Everything is a projection of it: the LLM context is built from it, clients tail it, and a session whose newest turn lacks a turn-end event is by definition mid-turn. Events are never rewritten.

Each turn runs as a queued job (BullMQ, one job per turn); whichever replica's worker holds the job drives the loop. Two mechanisms make replica failure safe:

- **Fencing.** Every event carries a per-turn sequence number with a uniqueness constraint. A replica that lost its claim keeps failing its next append and yields — two loops can never interleave one conversation.
- **Resume.** A periodic sweep re-enqueues running turns whose heartbeat has gone stale. The resumed loop replays the log, appends a synthetic *interrupted* tool result for any tool call left dangling by the dead replica, and continues — the model sees the failure and decides whether to retry. Re-running an interrupted shell command is accepted rather than journaled against.

**Compaction** is an event, not an edit: when reported prompt tokens cross a threshold, the loop appends a Compaction Event (an LLM-written summary plus the range it supersedes). Only the LLM context builder honors it; clients keep rendering full history. A failed summarization fails the turn visibly — context is never silently truncated.

## Tools and the exec surface

The loop's tools: shell execution (fresh shell per call, working directory persists across calls within a turn, env does not; explicit background jobs with tail/kill), file read/write/edit via the file-ops router, glob/grep, and a skill tool that lists and loads Local Skills from the PVC. Platform capabilities that pod harnesses reach over MCP become in-process calls here. User MCP servers are reached **in-pod** via the `mcpc` CLI from shell, so MCP traffic keeps the gateway, egress rules, and HITL — the loop never dials MCP servers from the api-server.

The exec surface on agent-runtime runs commands in the pod's injected runtime env, enforces a server-side timeout by killing the process group, and returns a bounded head/tail-truncated result — which is exactly what the event log stores and the model sees.

## Lifecycle

Wake is **lazy**: a turn touches the pod only when a tool call needs it, so tool-less turns (answering from history) run against a hibernated agent with no compute reserved. Each pod call routes through the reachability primitive, which bumps activity and defers hibernation while tools run. When a wake is refused — the owner Hard Stopped the sandbox, or the budget gate parks it Over Budget — the loop removes all tools, tells the model the real reason, takes one closing response, and ends the turn *interrupted*; the transcript explains why instead of silently failing.

Schedule fires on hosted agents skip the runtime channel: a fire creates (or, for continuous schedules, reuses) the schedule's hosted session and enqueues the turn directly — Postgres to Postgres, no pod-readiness precondition, no wake poke.

## Client surface: the ACP facade

During the transition, all clients reach hosted sessions through an **ACP facade**: the relay, on a hosted agent, terminates the connection at an in-process ACP server instead of dialing the pod. It serves session new/list/load/resume/mode/delete, prompts, cancellation, and the platform prompt-delivery and turn-ended notifications by projecting the Turn Event Log — live output is a poll-tail of the log, so a viewer on any replica sees a turn another replica is running. Hosted connections take no session-presence pin (an open tab must not wake the pod). The facade honors a **parity ceiling** — no hosted capability ships that ACP cannot express — and sunsets when a native chat surface ships, independent of pod-harness retirement. Terminal and SSH are separate protocols straight to the pod and work on hosted agents unchanged.

## Credentials, spend, and trust

The loop's LLM calls originate in the api-server and do not traverse the agent's gateway. The credential resolves through the same Connections model: a granted header connection whose injection host matches the configured LLM endpoint supplies the key (install-wide fallback key as a last resort). This deliberately widens what the api-server may read — it now holds LLM credentials in memory during a turn — accepted because the api-server already relays every conversation byte and decides every egress verdict ([security-and-credentials](security-and-credentials.md)).

Spend inverts trust for the better: the loop writes its own per-call token records into the agent-telemetry store, stamped with the agent's identity by platform code rather than reported by the agent ([metrics](metrics.md)). Everything the agent itself does — shell commands, `curl`, mcpc — still egresses through the paired gateway under egress rules, credential injection, and HITL, unchanged.

## Known gaps (hybrid v1)

- Hosted tool calls are not individually approval-gated (no `hosted_tool` pending-approval origin yet); the egress model still gates all network side effects.
- The model picker is hidden on hosted agents (harness-config reports unsupported); the template's configured model applies.
- Per-call cost is recorded as zero — token counters are exact, pricing is pending.
- Direct server-side MCP remains out until it carries an in-process equivalent of the ext_authz gate.
