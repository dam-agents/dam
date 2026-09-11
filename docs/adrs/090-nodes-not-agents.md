---
id: 090
title: Kubernetes orchestrates nodes, the node orchestrates agents
status: accepted
supersedes: 089
subsystem: platform-topology
tags: [multi-node, kubevirt, leader-election, placement]
summary: The platform runs on several node VMs; Kubernetes returns to run the shared services and provision the nodes, and is never told an agent exists.
---

# ADR-090: Kubernetes orchestrates nodes, the node orchestrates agents

**Date:** 2026-09-11
**Status:** Accepted
**Owner:** @JenomPokorny

## Context

ADR-089 committed the platform to one node, which is what let the orchestration
layer be deleted. That commitment has run out: an install has to spread agents
across machines, has to keep the roles that admit exactly one holder — the
messenger workers, the agent watch — from being answered twice, and has to
survive a machine going away without losing the work on its disk.

The isolation model is not what is being reconsidered. Everything ADR-089 made
structural — gVisor as the substrate, topological egress isolation, identity by
unix socket, the agent as a database row, the api-server as the thing that
builds a sandbox — holds unchanged, and none of the deleted orchestration code
comes back.

## Decision

A node is a VM running the whole api-server, supervising only the agents
assigned to it. **Kubernetes orchestrates nodes and never agents**: the cluster
runs the shared services every node depends on and provisions the node VMs, and
is never told that an agent exists. An agent remains a database row supervised
by one process on one machine.

What holds the nodes together:

- **A node registers itself.** It is created out of band, reads its identity and
  the shared endpoints from its own configuration, writes its row and
  heartbeats. Liveness is computed from that heartbeat on read, so each row has
  one writer and nothing arbitrates who is alive. This contract is the whole
  interface a node has to the thing that created it, which is what lets a local
  VM and a cluster-provisioned VM be the same node.
- **Placement is a third field on the agent record**, beside intent and observed
  state, written only by the scheduler. It is decided at wake rather than at
  create, preferring the node that ran the agent last.
- **One holder, elected on a database lock** held on a connection of its own, so
  it dies with the connection rather than expiring on a lease.
- **The workspace lives on the node's disk and moves node to node.** The record
  names the node whose copy is current; a node placed with an agent it does not
  hold fetches it from there before starting it. A crash loses nothing, because
  the disk is the durability story; a node that is down cannot be evacuated,
  which is the same fact the record already carries.
- **A node reaches another node's agents over a mutually authenticated link**,
  both ends holding a leaf from one install-wide CA. Callers inside the
  api-server resolve an agent to an address and are unaware of the hop.
- **State that used to be a node's own becomes the install's**: credential
  material and the CA move from a node's disk into the database, because any
  node may be asked to run any agent.

## Alternatives Considered

- **Kubernetes orchestrates agents again (the Agent CRD and controller)** — the
  ~28k lines ADR-089 deleted, to schedule workloads whose isolation the node
  already owns.
- **Kubernetes Leases and the API for coordination** — the api-server runs in a
  guest VM, not a pod; reaching the API needs a projected token, RBAC and the
  client library back in the tree to do what one advisory lock already does.
- **Shared network storage for agent workspaces** — a build in a workspace is
  the latency-sensitive case, and a network filesystem is the thing the
  node-local disk was chosen over.
- **Object-store snapshots as the transfer path** — a second copy of the
  workspace is a second truth to keep current and to explain when it is stale.
- **A per-agent VM instead of a per-node VM** — measured at a full VM boot per
  agent against 64–73 ms to start a gVisor sandbox, for isolation the sandbox
  already provides.

## Consequences

- **Easier:** an install grows by adding a VM. Agents spread across nodes, and
  draining a machine is cordon-plus-ordinary-lifecycle rather than an outage.
- **Easier:** the shared services are back under a chart and a cluster that
  already knows how to run them, instead of one node's systemd units — which is
  also what restored object storage, without which the artifact library and
  knowledge-base sharing were failing closed.
- **Harder:** correctness now depends on scoping. The supervisor's teardown
  sweep is the sharp edge — the same loop that is correct on one node destroys
  another node's agents if it reconciles against every record instead of its
  own.
- **Harder:** the in-process change stream is no longer the whole install. It is
  republished over Redis, and that hop is advisory: a lost message is bounded by
  the periodic sweep rather than by delivery.
- **Harder:** a second dependency for anyone running the platform. ADR-089's
  install was one image and no cluster privileges; this one is a cluster plus
  node images, and the destination is OpenShift with the node VMs under
  KubeVirt.
- **Committed-to:** the node contract. A node is created out of band and
  registers itself, so anything elastic — autoscaling, replacing a failed
  node — is a caller of that contract and not a change to the node. Verified on
  OpenShift Virtualization: gVisor runs unmodified inside a KubeVirt guest on
  all three of its platforms, and sandbox start there measured 64–73 ms.
- **Committed-to:** an agent belongs to one node at a time. Nothing runs an
  agent in two places, and nothing serves its workspace from two, which is what
  keeps the local disk usable as the source of truth.
