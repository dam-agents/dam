---
id: 100
title: Agent relays connect on a health answer before Ready is written
status: accepted
supersedes:
subsystem: agent-lifecycle
tags: [wake, readiness, relay, latency]
summary: While they hold for a wake from hibernation, the api-server's agent relays open their upstream on the agent's first health answer once its gateway pod is Ready, without waiting for the controller to write the Agent's Ready condition; a restart or roll of a running agent, and every other caller, still waits for Ready.
---

# ADR-100: Agent relays connect on a health answer before Ready is written

**Date:** 2026-10-13
**Status:** Accepted
**Owner:** @JanPokorny

## Context

ADR-032 made observed `Ready` the authoritative answer to "can I call this pod?".
For a waking vm agent, the controller writes `Ready` only at the end of a full reconcile that starts after the runner's prober sees the guest answer.
Two traced wakes on dev on 2026-10-13 put the guest's first `/healthz` answer at 2318 ms and 2383 ms after the click, and the `Ready` write at 2792 ms and 2770 ms: the user's first message waited about 0.4 s for a pod that already answered.
The reconcile itself took 310–330 ms over about 60 sequential API calls, and the wait for it to start took 60–160 ms.

## Decision

While an agent relay holds a connection for a wake from hibernation, it opens its upstream on the agent's first `/healthz` answer, provided the cached Agent already shows its gateway pod Ready, no stop requested and no runtime migration in progress; otherwise it waits for `Ready` as before.
This refines ADR-032 for agent relays only: `Ready` stays the authoritative answer for every other caller, channels and the scheduler included.

- **Wakes from hibernation only.** The shortcut applies only when the hold began on a hibernated agent, or on one with a wake from hibernation requested.
  A restart or roll of a running agent waits for `Ready`: during a spec restart of a vm agent, the old machine keeps answering `/healthz` on the same port while the new image pulls, so an answer does not tell the two apart.
- **The gateway gate.** The shortcut needs the gateway pod Ready, so an agent never takes a prompt before it has egress.
- **The wake still decides failure.** The wake keeps running alongside the health poll; if it fails before an answer arrives, the relay closes with the wake's error, as before.
- **Same probe as the platform's.** The relay asks the same `/healthz` that the runner prober and the kubelet ask, through the agent's Service.

## Alternatives Considered

- **Write Ready early in the reconcile** — saves less (about 280 ms against about 430 ms), and a reconcile already in flight could write the old readiness back and flip `Ready`.
- **Have the health answer carry a published revision** — lets restarts use the shortcut too, but needs the spec revision carried from the controller into every runtime and backend, a larger change than the latency it saves.
- **Stop the old machine before the new image pulls** — makes a health answer during a restart always the new machine's, but every restart then waits the whole pull with the agent down.
- **Keep waiting for Ready** — leaves about 0.4 s on every wake of a vm agent.

## Consequences

- **Easier:** The upstream opens about 0.4 s sooner on a wake from hibernation: the traced gap from health answer to relay attach was 495–545 ms, against at most a 100 ms poll plus a connect.
- **Harder:** Two readiness signals now exist for one pod; a relay can be connected while the Agent still shows not Ready, so status shown to the user can lag a working session by up to one reconcile.
- **Harder:** Each holding relay adds a health request every 100 ms to a waking agent until it answers or the wake ends.
- **Harder:** A restart or roll of a running agent keeps the full wait for `Ready`, about 0.4 s more than a wake from hibernation.
- **Committed-to:** A hibernated agent having no machine or pod left that answers `/healthz`; if hibernation ever kept one answering, its answer would open relays before the woken agent runs.
- **Committed-to:** `/healthz` staying the check that makes the agent Ready; if Ready gains a condition that `/healthz` does not reflect, relays connect before that condition holds.
- **Committed-to:** The gateway pod's readiness being written before, or independently of, the full reconcile; if it moves to the end of the reconcile with `Ready`, the shortcut stops saving anything.
