---
id: 124
title: One gateway pod per owner serves all of that owner's vm Agents
status: accepted
supersedes:
subsystem: security-and-credentials
tags: [gateway, envoy, vm, wake, latency, mesh, networkpolicy]
summary: Each owner gets one long-lived gateway pod beside their VM runner, reached by each vm Agent through its own Service address and port, where a per-agent listener carries that agent's credentials, egress checks, spend meter and resolver; per-agent gateway pods, and the gateway's part in hibernation, go away.
---

# ADR-124: One gateway pod per owner serves all of that owner's vm Agents

**Date:** 2026-10-17 **Status:** Accepted **Owner:** @JanPokorny

## Context

A vm Agent's gateway is a StatefulSet of its own that hibernation scales to zero with the machine.
Measured on dev on 2026-10-16 on one clock, a warm wake has the guest answering at about 0.9 s, but the gateway pod (Envoy and the machine resolver) takes about 1.7 s to become Ready, so the Agent is Ready only at about 1.9 s and the runtime's first hello fails.
A gateway pod uses about 59 MiB (Envoy 40, CoreDNS 19) and requests 80 MiB.
Dev runs 104 vm Agents for 30 owners; prod has about 319 Agents for about 151 owners, all moving to the vm Backend, since the container Backend and Kata are going away.
ADR-093 planned one gateway per owner as a sidecar of the runner; that was dropped because an escaped guest is root in the runner pod, and the runner's NetworkPolicy and each gateway's ingress policy are the kernel gates behind smolvm's in-process allowlist.
The per-owner gateway therefore stays a pod of its own.

## Decision

Each owner with vm Agents gets one gateway pod, created with their VM runner and removed with it, and every one of the owner's vm Agents egresses through it; hibernation no longer touches the gateway, so no wake waits for a pod to start.
Agent identity stays decided by the network path, never by anything the guest sends.

- **Identity is the agent's own Service address and port.** Each vm Agent keeps its own gateway Service and ClusterIP, which is still the one destination in its machine's allowlist and its resolver.
  That Service selects the owner's gateway pod and maps its ports onto ports that belong to that agent alone.
  Behind each such port is a per-agent listener carrying exactly that agent's chains, credentials, egress checks, spend meter, attribution and ext_authz destination.
  A guest reaches only the ports its own Service declares, since the owner's pod address and its siblings' addresses stay outside its allowlist.
  SNI, Host, source address and headers are never read as identity; every machine's traffic arrives from the runner's address anyway.
- **One resolver per agent, in one process.** The owner's resolver serves one port per agent, each answering every public name with that agent's ClusterIP, with today's no-forward, no-log rules.
- **Configuration changes without restarts.** Listeners, clusters, the resolver's blocks, credentials and leaf certificates are files the running gateway watches.
  A change to one agent replaces only that agent's listener, which drains its own connections; the others keep theirs.
  The pod restarts only for a change to its pod template: image, resources, or the install's trust settings.
- **Credentials only for what is granted.** The pod holds the union of the credentials granted to the owner's vm Agents, gathered by the controller into one per-owner Secret; each listener references only its own agent's.
  The leaf certificate is per owner, naming the union of the hosts its agents intercept.
- **Mesh identity becomes per owner.** The gateway pod's workload identity is the owner's, and each agent's harness and ext_authz policies admit that identity.
  Because the mesh no longer separates an owner's agents at the harness, each agent's listener admits harness requests only under that agent's own path, and terminates the harness tunnel to check it.
- **Policies per owner.** One ingress policy admits the owner's runner on the agent ports and the controller on them for readiness; one egress policy, unchanged in content, replaces the per-agent ones; the runner's egress policy names the owner's gateway and its agent ports.
- **Readiness per agent.** An agent's gateway is ready when the owner's pod is ready and that agent's listener and resolver block answer through the agent's own Service with the revision the controller last rendered.
- **Hibernation no longer lives in a gateway replica count.** Whether an agent should be up is recorded on a controller-owned object of the agent's instead.
- **A gateway restart is the owner's, and is rolled.** Template changes surge a new pod before the old one stops and pace across owners like runner rolls.
- **Scope.** Only vm Agents move.
  Container Agents and in-flight runtime migrations keep their per-agent gateways until the container Backend is removed; an Agent moves to its owner's gateway when its Backend switches.

## Alternatives Considered

- **Keep each vm Agent's gateway at one replica through hibernation** — fixes the wake as fully, in a few lines and with no security change, at 80 MiB requested and one pod per Agent asleep or awake: about 8.1 GiB and 104 pods on dev, about 24.9 GiB and 319 pods on prod, against about 2.3 GiB and 30 pods, and 11.8 GiB and 151 pods, at today's request per pod before the per-listener cost is measured.
- **Gateway as a container of the runner pod** — an escaped guest is root there and would read every key; the kernel gates sit between the runner and the gateway.
- **One gateway Deployment for all owners** — needs per-request identity asserted by the runners and puts every owner's credentials in one process.
- **Identity by SNI, Host or a header** — the guest writes all three.
- **Identity by source address** — every machine's traffic leaves from the runner's address.
- **An xDS server in the controller** — the controller would be on the gateway's start path; it stays the upgrade path if the file sizes below are hit.
- **Mount each credential Secret on the pod** — adding a Connection would change the pod spec and restart every agent of the owner.
- **Keep per-agent leaf certificates** — one more copy per agent for no gain, since the guest trusts the platform CA for every name anyway.
- **Gateway kept warm for some hours after hibernation** — keeps the per-agent model, but still pays the cold start on any wake beyond the window, and how long that window must be is unmeasured.

## Consequences

- **Easier:**
  - A warm wake no longer waits on a pod start: the 1.7 s gateway start leaves the critical path, and the runtime's first hello meets a listener already there.
  - Pods and requests drop from one per Agent to one per owner: 104 to 30 on dev, about 319 to 151 on prod.
  - A credential grant or an egress rule promotion no longer restarts a gateway: today each one rolls the agent's pod.
- **Harder:**
  - A gateway restart or crash cuts egress, model streams included, for every running agent of the owner at once, where today it cuts one.
    Spend survives it through the periodic records, but the calls themselves fail.
  - A compromised gateway process reads the keys granted to all of the owner's vm Agents; today it reads one agent's grants.
    An escaped guest already uses every gateway of its owner through the runner, but cannot read their keys, so the read is new.
  - Within an owner, the harness boundary between agents moves from the mesh's cryptographic check into the gateway's configuration: a fault there lets one agent act as a sibling on the harness, where today the mesh refuses it.
  - One owner's agents share the gateway's CPU and memory: one agent's traffic can slow its siblings.
  - The controller writes credential bytes for the first time, into the per-owner Secret.
  - The owner's configuration must fit in one ConfigMap and one Secret of at most 1 MiB each.
    A rendered gateway takes about 11 KB plus 4 KB per credentialed host today, before spend metering.
- **Committed-to:**
  - A per-agent ClusterIP and per-agent ports as the agent's gateway identity, and the runner's address carrying no identity.
  - File-watched dynamic Envoy configuration, and the per-owner Secret and ConfigMap as the gateway's whole input.
  - The per-agent gateway code until the container Backend is deleted.
