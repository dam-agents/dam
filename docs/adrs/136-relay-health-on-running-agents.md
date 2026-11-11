---
id: 136
title: Agent relays trust a health answer on a running agent unless its machine is being replaced
status: accepted
subsystem: agent-lifecycle
tags: [wake, readiness, relay, latency]
summary: An agent relay's hold also opens its upstream on the agent's health answer when the hold began on a running agent whose readiness went down for its current spec, unless the controller reports that the agent's machine is being restarted or stopped; the controller now names a restart on the machine's readiness so the relay can tell.
---

# ADR-136: Agent relays trust a health answer on a running agent unless its machine is being replaced

**Date:** 2026-11-10 **Status:** Accepted **Owner:** @jezekra1 **Amends:** ADR-100

## Context

ADR-100 lets a relay hold open on the agent's first health answer only on a wake from hibernation, because during a restart the old machine keeps answering while the new image is fetched.
Every other hold on an agent that is not `Ready` waits for `Ready`.
On dev on 2026-11-10 that left open sessions empty for minutes on agents that were up the whole time (#6434).
During a deploy the controller could not reach a VM runner for about 9 minutes and reported the running agent `MachineNotReady`: every open waited out the 120 s wake timeout and retried.
Under CPU load one missed ready check made an open wait 9 s for a "wake" of a running agent.
In neither case was a machine being replaced, but the relay could not tell those holds from a restart.

## Decision

A hold that begins on a running agent that is not `Ready` also opens its upstream on the first health answer, with ADR-100's gateway gate, when the machine's readiness was published for the Agent's current spec, no stop is asked for, and the controller does not report the machine restarting or stopping.

- **The controller names a restart.** While the runner restarts a vm machine — onto a new spec, or because its guest stopped answering — the machine's readiness carries a reason of its own for the whole restart, kept while the runner cannot be reached; a hold that begins on it, or sees it begin while it polls, waits for `Ready` as before.
- **A spec change is a restart.** Readiness written for an older spec than the Agent's means a roll may be under way, so it is not trusted either.
- **The relay records its holds.** Each hold is traced with how it began and ended, so a slow open can be broken down.

## Alternatives Considered

- **Have the health answer carry the machine's revision** — still the stronger fix ADR-100 set aside: every runtime and backend would need the spec revision, a larger change than the outage it closes.
- **Shorten the wake timeout for a running agent** — a hold during a 9-minute controller outage still fails, only sooner.
- **Fall back to the answer after a grace period** — still trusts an old guest whenever a restart outlasts the grace, which an image fetch can.

## Consequences

- **Easier:** an open on a running agent that the controller briefly cannot see attaches as soon as the guest answers, about 100 ms of polling, instead of waiting up to 120 s and retrying.
- **Harder:** a relay can now attach to a running agent whose status still reads as starting, for as long as the controller cannot reach its runner.
- **Harder:** every hold on a running agent that is not `Ready` polls the agent's health at 100 ms until it answers or the hold ends, as a wake from hibernation already did.
- **Committed-to:** every path that replaces a running vm machine passing through the runner's restarting state or a stop, both of which the controller now reports; a path that swapped the machine in place without either would let an old guest's answer through.
- **Committed-to:** the restart reason staying on the machine's readiness until the restarted machine runs; a controller that dropped it while the runner is out of reach would let the old guest's answer through.
