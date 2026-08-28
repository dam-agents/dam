---
id: 087
title: Knowledge-base sharing via a published read-only MCP snapshot
status: accepted
subsystem: knowledge-bases
tags: [knowledge-bases, mcp, object-store, connections]
summary: Serve knowledge-base shares from a published object-store snapshot over a read-only aggregate MCP endpoint consumed in-cluster, not by proxying the live agent.
---

# ADR-087: Knowledge-base sharing via a published read-only MCP snapshot

**Date:** 2026-08-25
**Status:** Accepted
**Owner:** @jjeliga

## Context

#3291 asked for a way to let one curated knowledge base serve other people's sandboxes without each one re-ingesting its sources. A knowledge base is an ordinary agent with content on its PVC, so the naive path — let consumers talk to that agent — would run the owner's LLM and pod for every foreign query, tie share availability to the owner's budget and hibernation, and hand read access through a live, write-capable workspace. What exactly is shared, and how it is served, needed a decision.

## Decision

A shared knowledge base is served as a **published, read-only snapshot** of the owner-selected top-level workspace directories, copied file-by-file into the object store with a manifest and a publish-time full-text index, and exposed through one aggregate MCP endpoint offering content-agnostic retrieval only (list, read, index-backed search, grep). Serving never touches the agent and runs no LLM: a query costs the owner nothing and keeps answering while the KB is hibernated, parked over budget, or stopped.

- Consumers read **in-cluster** over the harness route the agent already uses for platform-outbound, not the egress gateway; the public share host stays as a by-link endpoint for external MCP clients and the e2e.
- Access is one **durable share string**. The per-share secret is stored retrievably — durable re-copy is the product contract — and validated against the live share on every request: the set of valid secrets *is* the accessible set, so rotate and revoke are the only access control. There is no per-consumer identity and no ACL beyond the grant.
- Freshness is the pod's own job: a filesystem watch on the share roots inside the agent pod sets a dirty marker persisted on the agent's volume and, after a quiet period, the pod asks the platform to publish — so edits from every write path (chat turns, SSH, the file panel, scripts) republish without per-share platform bookkeeping, and a killed pod flushes its marker on the next boot. An explicit hard refresh publishes without the quiet wait — available to the owner from the UI and to the KB's own agent through a platform MCP tool.

The snapshot is **computed in the knowledge base's own agent pod** — both the shared file objects and the search index — and written to object storage by the agent through **short-lived presigned upload URLs scoped to that share's key namespace**, the way artifacts are uploaded. The pod also **initiates** the publish: it requests a work order from the api-server, uploads at its own pace, and reports completion, the ticket binding the two calls being the publish claim itself — no long-held call and no server-side timer exists anywhere in the flow. The api-server only authorizes (diffs against the previous manifest and mints every URL — the pod never chooses a storage key), verifies each uploaded object's existence and size at commit, and writes the manifest; it does not read the workspace or build the index on its own event loop.

- Publishing is **incremental**: the agent diffs its current workspace against the previous snapshot by content hash and re-reads, re-indexes, and re-uploads only what changed; unchanged file objects carry forward by content-addressed key. The filesystem watch only *triggers* a publish — the hashing walk stays the integrity authority, so a missed or spurious watch event costs freshness, never correctness.
- The index format is **bounded-memory and mergeable**: a full build runs in a tunable, corpus-independent memory budget, merging a changed subset into a prior index instead of rebuilding the whole thing; exceeding the budget degrades gracefully to a partial or absent index (serving falls back to list/read/grep), never to a crash. The build is deterministic compute, not a model turn, and its format is versioned and shared between agent and api-server, which rejects or rebuilds a version it cannot read.

## Alternatives Considered

- **Proxy the live agent** — every foreign query would run the owner's LLM and pod, couple share availability to the owner's budget and hibernation, and expose a read path into a write-capable workspace.
- **Copy / re-ingest into each consumer** — duplicates storage and ingestion cost per consumer and drifts from the source the moment the owner curates.
- **Consume over the egress gateway / public share host** — agents cannot reach the share host in-cluster (a `*.localhost` dev host resolves to loopback; a real host needs a fragile public-LB hairpin, and the agent NetworkPolicy fences in-cluster targets), and the contract is strictly in-cluster traffic.
- **HMAC-only secret (the API-keys model)** — precludes durable re-copy of the share string, which is the owner-facing product contract.
- **Build the snapshot on the api-server** (inline, or hardened with a worker thread and a publish gate) — a build sized by user content on the shared process risks an out-of-memory that takes the whole install down; a worker thread shares the pod cgroup, so it moves CPU off the event loop but leaves the blast radius. Acceptable only as an interim stopgap, not the destination.
- **Offload the build to a dedicated worker pod (job queue)** — isolates the blast radius but only relocates the work, still re-pulls the whole workspace over the network, and adds a pod to operate; kept as a contingency if adoption outpaces the agent-computed path.
- **Mount object storage into the agent filesystem** — needs a storage driver the current object store does not provide; deferred as infrastructure discovery.
- **Server-initiated orchestration** (the api-server watches each share over a standing pod subscription, debounces per share, and drives the pod through batched calls) — built first, then replaced: it kept a watch connection and a timer per shared KB on the shared server and held long server→pod calls bounded by client timeouts; pod initiation deletes all three.

## Consequences

- **Easier:** one curated KB serves many teams at zero marginal owner cost — no LLM or pod runs per consumer query, and a snapshot answers while the KB is hibernated, over budget, or stopped.
- **Easier:** read-only is structural, not policed — no code path from a consumer request reaches an agent, its PVC, or any write rail, so there is no ACL surface to get wrong; document reads resolve only through the snapshot manifest.
- **Easier:** the content-sized, unpredictable build leaves the shared api-server process — the measured hundreds-of-MiB resident spikes and event-loop stalls on the ext-authz path no longer land there, and an out-of-memory during a build costs one KB a retry in its own pod instead of a whole-install outage. The agent reads its own local filesystem, and an incremental publish makes a one-file edit cost roughly one file of work instead of a full re-read, re-index, and re-upload.
- **Harder:** shared content is only as fresh as the last successful publish, not live — bounding staleness requires the debounced republish and wake-time catch-up, and a failed republish leaves the previous snapshot serving.
- **Harder:** the share secret is stored retrievably rather than hashed — a deliberate weakening from the API-keys HMAC model, justified only by the re-copy contract, with rotation as the sole revocation lever.
- **Harder:** the search-index format now lives in two images and must be versioned and kept compatible across agent and api-server upgrades.
- **Committed-to:** the object store is on the consumer read path and is written directly by agents (the artifacts precedent), with the api-server as the sole manifest authority and presigned-URL key scoping plus commit-time size verification as the only bound on what an agent can write for a share; the publish protocol spans the agent and api-server images, versioned by a runtime-hello capability; the in-cluster harness route carries a second consumer besides platform-outbound.
