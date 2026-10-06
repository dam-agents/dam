---
id: 097
title: An owner's VM runner pools memory and accounts for it by measured use
status: accepted
supersedes:
subsystem: vm-runner
tags: [vm, smolvm, memory, admission, capacity, hibernation]
summary: The runner's memory request and its admission follow what an owner's machines measurably use rather than their caps; under pressure new starts are refused and the owner's unattended idle agents are hibernated first, and guests return cold page cache to the host on their own.
---

# ADR-097: An owner's VM runner pools memory and accounts for it by measured use

**Date:** 2026-10-05
**Status:** Accepted
**Owner:** @JanPokorny

## Context

ADR-093 pooled CPU and storage per owner but kept memory sized per agent, rejecting a memory pool because overcommit needs a runner-side pressure controller and an out-of-memory runner takes every machine of its owner with it. Machines already hand freed guest memory back to the host through free-page reporting, so a machine's cap is a ceiling, not what it holds. On dev on 2026-10-05, an owner with four running machines had a runner memory request of 10,752 MiB while their VMMs held 474–783 MiB each, 2,270 MiB in total: the scheduler reserved more than four times what the guests used. Page cache is the exception, held by the guest until it frees it.

## Decision

An owner's VM runner pools memory across that owner's machines and accounts for it by what the machines measurably use, not by their caps: the scheduler reserves measured use plus headroom, the runner admits a machine while measured use leaves room under its limit, and under pressure the platform refuses new starts and hibernates the owner's unattended idle agents first. Guests return cold page cache to the host on their own.

- **A cap stays a ceiling.** Each machine keeps its configured size as the most its guest can see; only the accounting changes.
- **Measured, not declared.** The runner measures each running machine's resident memory and reports it; that, plus a per-machine headroom and the runner's reserve, is the runner pod's memory request, still never above its limit.
- **Admission against use.** A machine starts while measured use, the headroom of every running machine and the start's own allowance fit under the runner's limit, so one owner can run more machines than their caps add up to.
- **Pressure is the owner's own.** When measured use nears the runner's limit, the runner refuses new starts with the shortfall, and the platform frees room by hibernating that owner's agents under ADR-081's rules — unattended only, hibernation enabled, past the idle floor, longest-idle first, and only as many as cover the shortfall. No other owner's agent is ever touched.
- **Guests give back cache.** Each guest periodically reclaims its cold page cache, which free-page reporting returns to the host; anonymous memory is never pushed out, as guests have no swap.

## Alternatives Considered

- **Keep the request at the sum of caps** — the cluster keeps reserving several times the memory guests use.
- **Measured request, cap-based admission** — saves cluster reservations, but an owner still runs only as many machines as their caps fit, the bound users hit first.
- **Balloon inflation targets** — the VMM exposes free-page reporting only; driving a balloon would mean patching it.
- **Periodic drop_caches in the guest** — drops dentries and inodes with the cache and cannot be limited to cold pages.

## Consequences

- **Easier:** The scheduler packs runners by what guests hold; the dev measurement above would have reserved about 3–4 GiB instead of 10.5 GiB.
- **Easier:** A guest's file cache goes back to the host within seconds of being reclaimed: on dev, reclaiming 1.27 GB of guest cache dropped the VMM's resident memory from 2,029 MiB to 932 MiB in under 10 s.
- **Harder:** An owner whose guests grow together can still push the runner past its limit before pressure handling acts, and the kernel then kills the runner with every machine of that owner — the failure ADR-093 avoided by never admitting past the caps. Headroom and the pressure threshold bound how often; they cannot rule it out.
- **Harder:** The runner pod's request now moves with workload, so in-place resizes happen as guests grow and shrink instead of only on start and stop; a cluster without in-place resize keeps the install's request, which no longer matches what the runner admits.
- **Harder:** Reclaimed cache is read from disk again when it is next needed.
- **Committed-to:** Free-page reporting in the VMM and a guest kernel with cgroup v2 proactive reclaim; without either, measured use climbs to the caps and the pool degrades to today's per-agent sizing.
- **Committed-to:** ADR-081's eligibility rules, and the session pin behind them, now also decide which agents a runner under memory pressure hibernates.
