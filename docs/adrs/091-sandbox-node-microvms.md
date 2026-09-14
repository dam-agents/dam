---
id: 091
title: The vm Backend runs on a sandbox node pod holding /dev/kvm, not under KubeVirt
status: accepted
subsystem: platform-topology
tags: [vm-backend, smolvm, kubevirt, sandbox-node]
summary: A vm agent is a persistent smolvm microVM inside one chart-rendered sandbox node pod that holds /dev/kvm as a device grant and is driven through a small node agent; KubeVirt, its containerDisk image pipeline and the virtiofs PVC sharing are removed.
---

# ADR-091: The vm Backend runs on a sandbox node pod holding /dev/kvm, not under KubeVirt

**Date:** 2026-09-14
**Status:** Accepted
**Owner:** @JanPokorny

## Context

The `vm` Backend shipped as a KubeVirt VirtualMachine inside a virt-launcher pod, booted from a Fedora bootc containerDisk, with workspace PVCs shared into the guest over virtiofs. In practice it cost us on every axis: the disk image can only be built on an x86 host with loop devices and SELinux label writes, virtiofs refused non-root creates in the guest and forced root-in-guest workarounds, each VM carries a virt-launcher pod plus a full guest OS on top of the agent, and a node that runs KubeVirt is a Kubernetes node first — its capacity is shared with the platform stack and every VM pays the pod overhead. No environment exposes vm agents to end users yet, so the backend can be replaced without a migration path. Measured on the dev cluster (gVisor vs KubeVirt vs smolvm, Sept 2026), smolvm microVMs booted the agent image directly in seconds, ran an inner k3s, and needed nothing but `/dev/kvm` on the host.

## Decision

A vm agent is a persistent smolvm machine on a **sandbox node**: one chart-rendered pod (a single-replica Deployment) that runs smolvm and a small node agent from one image, holds `/dev/kvm` and `/dev/net/tun` as device-plugin resources (KubeVirt's plugins by default; a privileged pod on the local dev cluster, where nested virtualization supplies KVM but no plugin exists) and needs only NET_ADMIN beyond a container's default capabilities. The controller drives the node agent's TLS, token-authenticated machine API (ensure with the desired power state, status, delete) through a headless Service. The node agent drives smolvm through its CLI: smolvm's HTTP daemon only accepts registry images, which would have cost a local cluster a registry, and its CLI can resize a machine in place where the daemon cannot. The controller keeps everything else: the paired gateway StatefulSet and its policies are unchanged, the agent StatefulSet is simply not rendered, and the agent Service becomes selector-less with the node pod's IP and the machine's published port as its endpoint so the api-server dials a vm agent like a pod. Hibernation stops the machine; wake starts it; delete removes it with its disk.

The guest image is the ordinary agent image plus docker and k3s — an OCI image, no disk build, pulled by the node from its registry or taken from a locally loaded archive where no registry exists. Persistence is the machine's own storage disk on the node pod's volume: the boot bind-mounts the agent's persisted paths from it, so there are no per-agent PVCs, no virtiofs, and no storage-class or migration involvement; size, env and restart requests are applied in place (stop, update, start) so the disk stays, and only the image is fixed for a machine's life. Egress is the node's per-machine allowlist set to exactly the paired gateway's ClusterIP, which the machine reaches over the pod network; that replaces the per-pair NetworkPolicy for vm agents.

One node per install. Placement across several nodes and per-user fair-use limits for machines are follow-ups; locally the install gives the k3s Lima VM nested virtualization and the same pod runs there.

## Alternatives Considered

- **Keep KubeVirt** — image build is x86-only, virtiofs breaks non-root guests, and every VM pays a pod plus a guest OS; the dev cluster could not even build the disk.
- **smolvm as a containerd RuntimeClass on Kubernetes nodes** — spiked: the shim maps PVCs and hostPaths to guest-internal disks, so nothing an agent writes persists; upstream also breaks on containerd ≥ 2.3.
- **gVisor sandboxes on a dedicated node** — cannot run an inner k3s or docker, which is the reason the vm Backend exists.
- **A machine outside the cluster, provisioned over SSH** — built first: a hook Job with an operator's sudo identity installing smolvm and the node agent on a bare host, with the Service CIDR routed through a Kubernetes node. Two kinds of host in one install, an SSH trust and internet-fetch requirement Helm never had, and locally a second Lima VM; the pod form keeps the same node agent and image and drops all of that.
- **A KubeVirt VM hosting the node** — one more hypervisor boundary around every machine, but smolvm inside the guest needs KVM inside the guest: fine on bare-metal virt nodes (verified on the dev cluster), impossible in the local k3s VM, whose Linux KVM on Apple silicon cannot nest again (measured: a KVM guest inside a nested-virt Lima VM gets no `/dev/kvm`). A cluster that wants that boundary can still run the same image inside a KubeVirt guest.
- **A fully privileged pod** — root on the node: a microVM escape would land in the kubelet's credentials. The device-plugin grant plus NET_ADMIN is what smolvm actually needs.

## Consequences

- **Easier:** the vm image builds anywhere docker builds (the bootc pipeline needed an x86 host with loop devices — it never built on the Mac or in the sandbox); a vm agent boots the agent image directly instead of a guest OS plus agent, and one node's whole CPU and RAM go to machines rather than to pods and platform services.
- **Harder:** the node pod runs as root with NET_ADMIN and holds a KVM device, so on OpenShift its ServiceAccount needs an SCC binding that admits that; a pod restart is a stop of every machine (they are its processes), so a node roll interrupts every vm agent's turn, and the machines' hypervisor boundary is the only one between an agent and the node's kernel; machine readiness has no informer, so the controller polls it (3 s) instead of reacting to pod events; a template image upgrade does not reach an existing machine (a new image needs a new machine, and the workspace lives on that machine's disk) where a pod simply rolls; the guest's inbound gate is a source allow-list on the node, not a per-pair kernel policy; and private-registry credentials live in smolvm's settings on the node rather than in the Agent's pull secret.
- **Committed-to:** the node agent's machine API, its token and TLS pair are the contract between controller and node; smolvm's CLI is the contract between the node agent and smolvm; an agent's workspace lives only on that node's volume (one PVC for all machines, no per-agent storage, no migration path between nodes); budgets count a vm agent by its gateway, so the pair's gateway StatefulSet stays the controller's record of "desired up" for every Backend.
