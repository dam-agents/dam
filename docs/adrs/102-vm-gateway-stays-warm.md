---
id: 102
title: A vm Agent's gateway stays up through hibernation for a window after its last activity
status: accepted
supersedes:
subsystem: agent-lifecycle
tags: [vm, gateway, hibernation, wake, latency, cost]
summary: A hibernated vm Agent stops its machine but keeps its gateway pod for a window after its last activity (8 hours by default), so a wake in that window starts only the machine; the controller records the hibernation on the Agent instead of reading it from the gateway's replica count.
---

# ADR-102: A vm Agent's gateway stays up through hibernation for a window after its last activity

**Date:** 2026-10-13 **Status:** Accepted **Owner:** @JanPokorny

## Context

Hibernation scales both halves of an Agent to zero.
On the `vm` Backend, a wake now boots the machine in under a second, and the gateway pod has become the slowest part.
On dam-dev on 2026-10-13, a waking gateway pod went from Pending to Ready in about 1.3 s, and up to 1.95 s, with images cached and no probes.
About 0.7 s of that is the pod network (OVN-Kubernetes and Istio ambient), and 0.7–0.9 s is the kubelet's status lag.
It sets the tail of opening a past session, about 2.0 s in total, even though the gateway is now started before the machine.
The controller also read a vm Agent's hibernation from its gateway's replica count, so the gateway could not stay up without a new signal.

## Decision

A hibernated `vm` Agent stops its machine and keeps its gateway pod running for a window after its last activity, so a wake inside the window starts only the machine.
The decision was the user's; the window and its default are the author's (open).

- **Bounded by recent activity.** The gateway stays up while the Agent's last activity is younger than an install setting, 8 hours by default; past that the idle checker scales it down, and the next wake starts it as before.
  `0` turns the decision off. (open: the default, chosen to cover a working day.)
- **Only idle hibernation keeps it.** Idle hibernation and reclaim for runner memory keep the gateway; a hard stop, a pause, a park over budget and a delete take it down at once, as before. (open)
- **Only the `vm` Backend.** A container Agent's agent pod is as slow to start as its gateway, so it gains nothing; and the `vm` Backend is the default.
- **Hibernation is recorded, not inferred.** Every scale-down records on the Agent that the controller took it down, before it asks the runner to stop the machine, and the wake that follows removes that record.
  That record, not the gateway, is what holds the machine stopped and what the runner's memory accounting reads.
- **The gateway stays correct while the machine is off.** It holds no state of its own beyond its configuration and mounted credentials, so it is kept current as a running gateway is: a configuration change rolls it, and a rotated credential reaches it within seconds.
  The ext_authz decision stays per request in the api-server.
- **Readiness is unchanged.** A hibernated Agent still reports `Hibernated` on every readiness condition, gateway included; a wake publishes the gateway ready on its first reconcile.

## Alternatives Considered

- **Scale the gateway to zero, as today** — the wake keeps paying 1.3–1.95 s, the tail of opening a past session.
- **Keep every hibernated gateway up** — on dam-dev, 98 of 105 vm Agents were hibernated, so this would request 5.9 CPU and 7.7 GiB for gateways nobody used for days.
- **One shared gateway per owner** — the gateway is the per-Agent credential and egress boundary: one gateway would hold every Agent's Secrets, and per-Agent NetworkPolicies, AuthorizationPolicies and ext_authz identity would need a redesign.
- **A warm pool of unassigned gateway pods** — a pod's Secret mounts, ServiceAccount and Istio identity are fixed at creation, so a pooled pod cannot become a given Agent's gateway without a restart.

## Consequences

- **Easier:** a wake inside the window waits only for the machine. On dam-dev the agent side was ready about 0.85 s after the wake began, and the gateway decided `Ready` up to 1 s later.
- **Harder:** every vm Agent active in the window holds a gateway pod. Each requests 60m CPU and 80 MiB; nine running gateways on dam-dev used 3–9m CPU and 45–76 MiB each.
  With the 8 h default, dam-dev keeps about 20 of its 98 hibernated gateways up: about 1.2 CPU and 1.6 GiB requested, 0.1 CPU and 1.2 GiB used.
  The gateway is outside the user budget, so this cost is the operator's.
- **Harder:** a gateway that fails while its machine is off is found only on the next wake, as readiness reports the Agent hibernated.
- **Committed-to:** the controller's own record of a hibernation is the only signal that a vm Agent's machine must stay down; anything that takes a vm Agent down must write it before the machine stops.
