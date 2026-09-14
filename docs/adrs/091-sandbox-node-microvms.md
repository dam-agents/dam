---
id: 091
title: The vm Backend runs on a sandbox node outside the cluster, not under KubeVirt
status: accepted
subsystem: platform-topology
tags: [vm-backend, smolvm, kubevirt, sandbox-node]
summary: A vm agent is a persistent smolvm microVM on one non-Kubernetes sandbox node that the chart provisions over SSH and drives through a small node agent; KubeVirt, its containerDisk image pipeline and the virtiofs PVC sharing are removed.
---

# ADR-091: The vm Backend runs on a sandbox node outside the cluster, not under KubeVirt

**Date:** 2026-09-14
**Status:** Accepted
**Owner:** @JanPokorny

## Context

The `vm` Backend shipped as a KubeVirt VirtualMachine inside a virt-launcher pod, booted from a Fedora bootc containerDisk, with workspace PVCs shared into the guest over virtiofs. In practice it cost us on every axis: the disk image can only be built on an x86 host with loop devices and SELinux label writes, virtiofs refused non-root creates in the guest and forced root-in-guest workarounds, each VM carries a virt-launcher pod plus a full guest OS on top of the agent, and a node that runs KubeVirt is a Kubernetes node first — its capacity is shared with the platform stack and every VM pays the pod overhead. No environment exposes vm agents to end users yet, so the backend can be replaced without a migration path. Measured on the dev cluster (gVisor vs KubeVirt vs smolvm, Sept 2026), smolvm microVMs booted the agent image directly in seconds, ran an inner k3s, and needed nothing but `/dev/kvm` on the host.

## Decision

A vm agent is a persistent smolvm machine on a **sandbox node**: a machine outside the cluster that the chart provisions itself — a hook Job SSHes in with an operator-supplied identity and installs smolvm's daemon and a small node agent — and that the controller drives over the node agent's TLS, token-authenticated machine API (ensure with the desired power state, status, delete). The node agent drives smolvm through its CLI: smolvm's HTTP daemon only accepts registry images, which would have cost a local cluster a registry, and its CLI can resize a machine in place where the daemon cannot. The controller keeps everything else: the paired gateway StatefulSet and its policies are unchanged, the agent StatefulSet is simply not rendered, and the agent Service becomes selector-less with the machine's published node port as its endpoint so the api-server dials a vm agent like a pod. Hibernation stops the machine; wake starts it; delete removes it with its disk.

The guest image is the ordinary agent image plus docker and k3s — an OCI image, no disk build, pulled by the node from its registry or taken from a locally loaded archive where no registry exists. Persistence is the machine's own storage disk: the boot bind-mounts the agent's persisted paths from it, so there are no PVCs, no virtiofs, and no storage-class or migration involvement; size, env and restart requests are applied in place (stop, update, start) so the disk stays, and only the image is fixed for a machine's life. Egress is the node's per-machine allowlist set to exactly the paired gateway's ClusterIP, with the node routing the Service CIDR through a Kubernetes node; that hop replaces the per-pair NetworkPolicy for vm agents.

One node per install. Placement across several nodes and per-user fair-use limits for machines are follow-ups; locally the install creates the node as a second Lima VM on the shared user-v2 network and lets the same chart hook provision it.

## Alternatives Considered

- **Keep KubeVirt** — image build is x86-only, virtiofs breaks non-root guests, and every VM pays a pod plus a guest OS; the dev cluster could not even build the disk.
- **smolvm as a containerd RuntimeClass on Kubernetes nodes** — spiked: the shim maps PVCs and hostPaths to guest-internal disks, so nothing an agent writes persists; upstream also breaks on containerd ≥ 2.3.
- **gVisor sandboxes on a dedicated node** — cannot run an inner k3s or docker, which is the reason the vm Backend exists.
- **Run the node agent on a Kubernetes node as a DaemonSet** — reintroduces the pod overhead and the shared-capacity problem the node exists to avoid; and it still needs a host-level machine store outside the pod.

## Consequences

- **Easier:** the vm image builds anywhere docker builds (the bootc pipeline needed an x86 host with loop devices — it never built on the Mac or in the sandbox); a vm agent boots the agent image directly instead of a guest OS plus agent, and one node's whole CPU and RAM go to machines rather than to pods and platform services.
- **Harder:** a second kind of host in the install — provisioned by the chart, but over SSH with sudo and an internet fetch of smolvm, which is a trust and reachability requirement Helm alone never had; machine readiness has no informer, so the controller polls it (3 s) instead of reacting to pod events; a template image upgrade does not reach an existing machine (a new image needs a new machine, and the workspace lives on that machine's disk) where a pod simply rolls; the guest's inbound gate is a source allow-list on the node, not a per-pair kernel policy; and private-registry credentials live in smolvm's settings on the node rather than in the Agent's pull secret.
- **Committed-to:** the node agent's machine API, its token and TLS pair are the contract between cluster and node; smolvm's HTTP API is the contract between the node agent and smolvm; an agent's workspace lives only on that node's disk (no cluster storage, no migration path between nodes); budgets count a vm agent by its gateway, so the pair's gateway StatefulSet stays the controller's record of "desired up" for every Backend.
