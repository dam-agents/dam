---
id: 120
title: The agent pod's configuration ends with the pod
status: accepted
supersedes: [043]
subsystem: platform-topology
tags: [vm, smolvm, helm, controller]
summary: With every agent a smolvm machine on its owner's runner, the chart-only agent base keeps only what still applies to a machine; the pod's security contexts, scheduling, runtime class, probes, metadata and workspace storage class are removed, and the chart refuses an install that still sets them.
---

# ADR-120: The agent pod's configuration ends with the pod

**Date:** 2026-10-23
**Status:** Accepted
**Owner:** @JanPokorny

## Context

ADR-093 made smolvm microVMs the only agent runtime, and the container backend is now removed: no agent pod, agent StatefulSet, warm pool or workspace volume is rendered any more.
ADR-043 split the agent pod's configuration into a chart-only base, chart-wide template defaults and per-template overrides, and most of the base described that pod: its security contexts, scheduling, runtime class, probes, metadata and its workspace volumes' storage class.
ADR-033's requirement that the controller render every agent pod under a sandboxing RuntimeClass, and ADR-073's per-template `runtimeClassName` and `nodeSelector`, also had the agent pod as their only subject.
A machine takes none of these: where it runs and what isolates it are its owner's runner and that runner's install values.

## Decision

The agent pod's configuration surface is removed with the pod.
The chart-only base keeps only what still applies to a machine — the pull secrets the runner fetches agent images with, and the one idle timeout every agent takes — and the template layers keep what seeds and sizes an Agent (image, env, mounts, storage size, skill sources).
Security contexts, scheduling, runtime class, probes, pod metadata, termination grace and the workspace storage class leave the chart.
Isolation and placement are the runner's: the hypervisor boundary per machine, the runner's own security context and placement per owner.
The chart refuses to render an install that still sets a removed key, since the controller refuses to start on a field its configuration no longer has.

## Alternatives Considered

- **Keep the pod fields, ignored** — an operator could set a security floor or a placement that silently does nothing.
- **Move per-template placement onto the runner** — a runner serves every template of one owner, so a per-template node selector has no workload to apply to.

## Consequences

- **Easier:** no chart value can relax an agent's isolation any more: the security contexts and egress lockdown an operator could weaken were pod settings, and a machine's floor is the hypervisor and its runner's own security context.
- **Harder:** no template can be placed on particular nodes or asked for a device: a GPU template has no path to a GPU, since a machine's spec forwards no device.
  An install upgrading with any removed key set fails its render until the key is deleted.
- **Committed-to:** the runner pod as the only place an install shapes where and how agents run; per-template placement or device access would need the runner, not a template, to carry it.
