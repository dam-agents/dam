---
id: 008
title: Controller-owned cron with exec-based trigger delivery
status: accepted
subsystem: agent-lifecycle
summary: Controller owns cron scheduling and delivers triggers by writing JSON files into the pod via kubectl exec, which agent-runtime watches to start ACP sessions.
---
# ADR-008: Controller-owned cron with exec-based trigger delivery

**Date:** 2026-04-02
**Status:** Accepted
**Owner:** @jezekra1

## Context

Scheduled agent execution needs a mechanism to tell a running agent pod "start a new task now." The Controller owns the cron scheduler, but the harness inside the pod is an opaque process — the platform can't assume any specific RPC interface since the harness is the developer's choice (ADR principles: harness-agnostic).

The delivery mechanism must work regardless of which harness is running and must use the same code path as interactive execution to avoid divergent behavior.

## Decision

The Controller delivers triggers via `kubectl exec`, writing a JSON file into `/home/agent/.triggers/{timestamp}.json` inside the running pod. The **agent-runtime** (the platform's adapter layer inside the pod) watches that directory, creates a new ACP session per trigger file, and deletes the file after processing. The actual harness (Claude Code, Pyre, etc.) is unaware of trigger files — it just receives a normal ACP prompt. This is a file-based integration contract: the controller doesn't call the harness directly, it drops a file. Anything that watches the directory works.

- The Controller owns all cron scheduling (harness has no internal cron)
- Trigger files contain the schedule name, timestamp, and any configured parameters
- Same trigger mechanism is used for both scheduled and on-demand execution
- Concurrent sessions are always allowed (no concurrency gating) — if a previous session is still running when a new trigger arrives, both run

## Alternatives Considered

**HTTP/gRPC endpoint on the harness.** Controller calls an API on the pod. Rejected: couples the platform to a specific harness interface. Not all harnesses expose an HTTP trigger endpoint, and adding one to the harness contract increases the integration burden.

**Message queue (NATS, Redis).** Controller publishes to a queue, harness subscribes. Rejected: adds an infrastructure dependency. The platform's "K8s is the database" principle (ADR-006) avoids external stateful services.

**Harness-owned cron.** Each harness runs its own scheduler. Rejected: duplicates scheduling logic across harnesses, no centralized schedule management, and the platform can't observe or control execution timing.

## Consequences

- Works with any harness that can watch a directory — no protocol coupling
- Scheduled and interactive execution share the same session-creation path in the harness
- `kubectl exec` requires the pod to be running — hibernated pods must be woken first (ties into ADR-007 wake-on-connect)
- No delivery guarantees — if exec fails (pod crash, network issue), the trigger is lost
- File-based delivery is simple but doesn't support acknowledgment or retry natively
