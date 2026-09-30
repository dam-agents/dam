---
id: 094
title: A local cluster may run without the mesh dataplane
status: accepted
subsystem: security-and-credentials
tags: [istio, ambient, local-dev, smolvm]
summary: A local development cluster whose kernel cannot run the ambient dataplane may install the platform with every AuthorizationPolicy rendered and none enforced; the chart accepts this only on a cluster the local install task marked, and that task refuses CI.
---

# ADR-094: A local cluster may run without the mesh dataplane

**Date:** 2026-09-30
**Status:** Accepted
**Owner:** @jezekra1

## Context

ADR-041 made the ambient mesh a hard prerequisite with no toggle, because the
mesh is the only authentication on the harness port. Some development
environments cannot run the ambient dataplane at all. smolvm's guest kernel,
the one the platform's own vm agents run in, is built with no module loading
and without ipset or conntrack marks and zones. On it istio-cni either
crash-loops (its iptables backend needs ipset), or, on its nftables backend,
reaches Ready and then rejects every pod joining the mesh: the kernel refuses
`ct mark set` and `ct zone set` with EOPNOTSUPP. An agent developing the
platform inside such a VM could bring up no local cluster at all.

## Decision

A local development cluster may run the platform with no mesh dataplane, and
nothing else may. The chart gains a local-only setting that renders every
AuthorizationPolicy but enrols no workload in the mesh. The chart accepts it
only on a cluster the local install task has marked, and that task refuses to
run under CI. Published charts, CI lanes, GitOps renders and real deployments
keep ADR-041's mandatory mesh unchanged.

- Enforcement stays the default. Turning it off takes an explicit flag on the
  install task, and the chart setting is refused without the task's marker.
- An offline render cannot show the cluster is local, so it is refused.
- The mode says so wherever a person looks: the install notes and the cluster
  status.
- The mode attempts no partial enforcement. Its only promise is that it is
  loud and cannot be reached by accident.

## Alternatives Considered

- **Enable the conntrack options in smolvm's guest kernel** — the real fix for
  the environment, pursued separately; it unblocks nothing until a smolvm
  release and a runner-image bump land.
- **Build our own guest kernel into the runner image** — breaks the single,
  digest-checked smolvm pin and adds a kernel build to every image build.
- **Patch istio-cni to skip the conntrack rules** — forks Istio, and those
  rules are what route a meshed pod's replies back through ztunnel.
- **A general `enabled: false` toggle** — what ADR-041 rejected: any deployment
  could switch off the only authentication on the harness port.
- **Sidecar mode on constrained kernels** — the waypoint, the identity
  principals and the chart's admission checks are all ambient; a second mesh
  mode doubles the security surface to review.

## Consequences

- **Easier:** developing the platform inside a smolvm guest. On 2026-09-30, in
  a guest where every pod-add into the mesh failed, the local install without
  the dataplane brought every platform workload to Ready, and the UI, the
  api-server and the Keycloak realm answered through ingress.
- **Harder:** on such a cluster the harness and ext-authz ports have no
  authentication. ADR-041 moved per-agent identity entirely into the mesh and
  retired the pair NetworkPolicy, so no other gate remains. No e2e spec asserts
  a denial, so the suite cannot tell this cluster from an enforced one.
- **Harder:** the guard is a marker, not a proof. Anyone with cluster-admin can
  create it. It stops accidental use in pipelines and real deployments, not
  deliberate misuse.
- **Committed-to:** every mesh-dependent chart resource must keep rendering
  with no dataplane: objects stay inert, and nothing may wait on ztunnel or a
  waypoint. The local-only marker, and the install task's refusal under CI.
