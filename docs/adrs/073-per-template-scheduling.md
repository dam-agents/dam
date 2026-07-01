# ADR-073: Per-template scheduling for runtimeClassName and nodeSelector

**Date:** 2026-06-25
**Status:** Accepted
**Owner:** @xjacka

## Context

All agent pod scheduling has been chart-wide: a single base block sets the
runtime class, node selector, tolerations, etc. for every agent equally. A new
GPU kernel-optimization workload must evaluate on an in-cluster NVIDIA GPU, and
agents run under a sandboxed (Kata) runtime. GPU passthrough under Kata requires
a GPU-capable runtime class (VFIO) that boots a heavier VM than the default
agent class — applying it chart-wide would impose the GPU VM configuration on
every CPU-only agent. The workload also needs to land on GPU nodes specifically.
A per-workload escape was therefore needed without abandoning the chart-wide
default for everything else.

## Decision

`runtimeClassName` and `nodeSelector` become per-template overridable agent-spec
fields; all other scheduling stays chart-wide. A template's runtime class
replaces the chart-wide one, and its node-selector labels merge onto the
chart-wide selector (template keys win on collision). Both default to inheriting
the chart-wide base when a template sets neither. The remaining scheduling
fields — tolerations, affinity, topology spread, priority class — and the entire
security context stay chart-only, because they are cluster policy rather than
per-workload requirements.

## Alternatives Considered

- **Keep scheduling fully chart-wide** — the GPU Kata runtime class would apply to every agent, booting the heavy GPU VM for CPU-only workloads.
- **Resource request only (`nvidia.com/gpu`), no runtime class** — under Kata the default sandbox runtime cannot pass through a GPU at all, so the pod would never get a working device regardless of the request.
- **A second chart-wide base profile selectable per template** — still cluster-level config; every new GPU class or node-label variant needs an operator chart edit rather than living with the template that needs it.

## Consequences

- **Easier:** A GPU workload ships its runtime-class and node-selector requirements in its own template; enabling GPU eval needs no change to the shared chart-wide scheduling base.
- **Harder:** The CRD schema generation was bumped (gen 2 → 3) and two scheduling fields now flow through every layer — CRD, generated TS types, contract schema, spec assembly, helm rendering — so future scheduling-shape changes touch more surfaces than the single base block did.
- **Committed-to:** Scheduling is no longer a single chart-only boundary; the agent spec is now a sanctioned carrier for these two scheduling fields, and the per-template-wins / merge-vs-replace semantics are load-bearing for any future per-workload scheduling need.
