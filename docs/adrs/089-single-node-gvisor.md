---
id: 089
title: One node, no orchestrator — the api-server supervises gVisor sandboxes
status: accepted
supersedes: [041, 042, 058, 061, 065]
subsystem: platform-topology
tags: [gvisor, systemd, kubernetes, networking]
summary: Drop Kubernetes; the platform runs as systemd services on one node and the api-server creates each agent's gVisor sandbox, network namespace and gateway itself.
---

# ADR-089: One node, no orchestrator — the api-server supervises gVisor sandboxes

**Date:** 2026-09-11
**Status:** Accepted
**Owner:** @JenomPokorny

## Context

The platform was a Kubernetes application: a Go controller reconciled an Agent
CRD into paired StatefulSets, Services, NetworkPolicies, PVCs, per-agent
ServiceAccounts, Istio AuthorizationPolicies and cert-manager certificates,
while the api-server used the Kubernetes API as its coordination bus and
Kubernetes Secrets as its credential store. That bought multi-node scheduling
and mesh identity the product has never used — every install to date has been
one node — and cost a cluster-admin install, a dependency chain through Istio
and cert-manager, and roughly 28k lines of orchestration code and Helm
templates. gVisor was in that picture as an optional RuntimeClass an operator
could opt into, so the isolation the product sells was a deployment choice.

## Decision

The platform runs on **one node** as systemd services, and the **api-server
itself** is the thing that creates an agent's sandbox: a gVisor container, its
network namespace, its paired gateway process and its credential files. There
is no orchestrator, no controller process, and no cluster to install into.

The boundaries that follow from that:

- **Isolation is the substrate, not a policy.** Every agent runs under gVisor.
  There is no configuration that turns it off.
- **Egress isolation is topological.** An agent's namespace holds one
  point-to-point link and nothing else — no default route, no resolver — so its
  only reachable address is its own gateway. A packet filter is defence in
  depth, not the boundary.
- **Identity is the socket.** Each agent's gateway reaches the api-server's
  harness and authorization endpoints over a pair of unix sockets created for
  that agent and readable only by that gateway's uid. No application-layer
  header conveys identity. This replaces SPIFFE and the mesh's authorization
  policies.
- **The agent resource is a database row.** Intent is `spec`, observed state is
  `status`, and one function writes the latter. The status subresource made that
  split structural; in one process it is a review rule.
- **An image is a manifest, some blobs and tar.** The api-server speaks the
  registry API itself and unpacks each image once into a directory every sandbox
  on that image shares read-only. There is no container runtime daemon.
- **The install is an image.** A bootc image carries the units and the
  dependencies; `bootc upgrade` is the upgrade path.

Agent images are untouched: the same OCI images, the same entrypoint, the same
harness contract.

## Alternatives Considered

- **Keep Kubernetes, make gVisor mandatory** — retains the cluster-admin
  install and the Istio/cert-manager chain, which is the cost we set out to
  remove.
- **Keep the controller as a second process on the node** — two lifecycles to
  keep in step for a reconcile loop that now has one reader and one writer.
- **Drive containerd with the runsc handler** — tried first and abandoned: the
  shim could not join a per-agent network namespace, and the daemon's image and
  container lifecycles duplicate the supervisor's.
- **Firecracker or Kata microVMs instead of gVisor** — a stronger boundary at
  the cost of a kernel and a disk image per agent; gVisor was already the
  isolation the product described.

## Consequences

- **Easier:** the install is one image and no cluster privileges, against a
  Helm chart of 55 files that required cluster-admin, CRD installation, Istio
  and cert-manager. Roughly 28k lines of orchestration code and templates are
  deleted rather than ported.
- **Easier:** egress isolation is now checkable by reading a routing table with
  one entry, rather than by reasoning about NetworkPolicy selectors, mesh
  membership and the interaction between them — the combination that produced
  the ambient-mesh and NetworkPolicy records this one supersedes.
- **Harder:** the api-server gains root. It creates namespaces, mounts
  overlays, writes packet-filter rules and starts sandboxes, none of which it
  could do before; the controller was previously the only privileged component.
  The privileged surface is confined to one module's infrastructure layer and
  the unit runs with a cut capability set, but the blast radius is real.
- **Harder:** the unit cannot use systemd's seccomp-installing hardening
  directives. `RestrictSUIDSGID`, `LockPersonality`, `RestrictRealtime` and
  `ProtectKernelModules` each install a filter that gVisor inherits when it
  re-execs itself for its sentry and gofer, and that exec then fails outright —
  every sandbox on the node fails to start. The same applies to every directive
  that implies a private mount namespace, because the per-agent network
  namespaces are bind mounts other processes must see.
- **Harder:** the write-contention guarantee is gone. A status subresource made
  "the controller never writes spec" impossible to violate; keeping a single
  `writeStatus` path is discipline a reviewer has to enforce.
- **Committed-to:** one node. Leases, cross-replica signalling and every
  fan-out assumption the api-server carried are deleted, so a future second node
  is a re-architecture, not a configuration change. The Redis bus survives as a
  deliberate no-op for the same reason it existed.
- **Committed-to:** owning the image path. Nothing else pulls, unpacks or
  imports images, so registry behaviour we would previously have inherited —
  authentication challenges, manifest indexes, whiteouts, layer compression — is
  now ours to keep correct.
