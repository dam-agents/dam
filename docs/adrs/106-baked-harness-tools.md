---
id: 106
title: The default image bakes its harness tools
status: accepted
supersedes:
subsystem: agent-images
tags: [agent-images, mise, disk, vm]
summary: The default image carries base's and every harness's tools in a layer of its own, installed at build time by the image's own installer, instead of booting on a tools directory each node installs and never prunes.
---

# ADR-106: The default image bakes its harness tools

**Date:** 2026-10-16 **Status:** Accepted **Owner:** @JanPokorny

## Context

Since the default image became one bare image for every harness, its tools have lived in a directory on each node, filled by an installer per node and mounted into every agent.
Each tool upgrade adds its versions beside the old ones and nothing removes them: on dev the directory held 5.2 GB per node, two to three versions of each tool, on nodes whose own disks are about 100 GB and were hitting disk pressure.
Nothing on the node accounts for that directory, so neither the kubelet nor the VM image cache can reclaim it.

## Decision

The default image carries base's and every harness's tools, Playwright's browsers among them, in a layer of its own at mise's system data dir, installed at build time by the image's own installer at the path the image runs them from.
A node then holds the tools only as part of an image: the kubelet's image collection drops a version no container agent runs, and the VM image cache's budgeted eviction drops one no machine boots.

The per-node directory stays only while an agent can still run an image that has no tools of its own, and goes once none can.

## Alternatives Considered

- **Prune the node directory** — bounds it to about one set of tools, but keeps a node cache nothing else on the node accounts for, and keeps the installer in every container agent's boot path.
- **Keep the directory as it is** — measured 5.2 GB per node and growing with every lockfile change.

## Consequences

- **Easier:** a node's tools are reclaimed by the mechanisms that already watch its disk; a container agent no longer depends on the node's installer having finished before it starts, a race that left an agent without a harness until its next start; the build's own tool install and CI's cache of it are the image's layer, so the tools are installed once per tool config rather than once in CI and once per node.
- **Harder:** the default image is about 3.3 GB larger (2.65 GB of tools, 0.7 GB of Chromium), so a node that lacks the layer pulls it before the first agent starts there, and every image built on the default image carries it; the VM image cache holds the tools inside its 20 GiB budget, so it evicts and refetches older images sooner.
- **Committed-to:** a tool upgrade is an image build, and reaches an agent when the agent moves to the new image, as every other image change does; the build needs root on its host, as the system-package layer already does.
