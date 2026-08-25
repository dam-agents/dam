---
id: 085
title: Knowledge-base sharing via a published read-only MCP snapshot
status: accepted
subsystem: knowledge-bases
tags: [knowledge-bases, mcp, object-store, connections]
summary: Serve knowledge-base shares from a published object-store snapshot over a read-only aggregate MCP endpoint consumed in-cluster, not by proxying the live agent.
---

# ADR-085: Knowledge-base sharing via a published read-only MCP snapshot

**Date:** 2026-08-25
**Status:** Accepted
**Owner:** @jjeliga

## Context

#3291 asked for a way to let one curated knowledge base serve other people's sandboxes without each one re-ingesting its sources. A knowledge base is an ordinary agent with content on its PVC, so the naive path — let consumers talk to that agent — would run the owner's LLM and pod for every foreign query, tie share availability to the owner's budget and hibernation, and hand read access through a live, write-capable workspace. What exactly is shared, and how it is served, needed a decision.

## Decision

A shared knowledge base is served as a **published, read-only snapshot** of the owner-selected top-level workspace directories, copied file-by-file into the object store with a manifest and a publish-time full-text index, and exposed through one aggregate MCP endpoint offering content-agnostic retrieval only (list, read, index-backed search, grep). Serving never touches the agent and runs no LLM: a query costs the owner nothing and keeps answering while the KB is hibernated, parked over budget, or stopped.

- Consumers read **in-cluster** over the harness route the agent already uses for platform-outbound, not the egress gateway; the public share host stays as a by-link endpoint for external MCP clients and the e2e.
- Access is one **durable share string**. The per-share secret is stored retrievably — durable re-copy is the product contract — and validated against the live share on every request: the set of valid secrets *is* the accessible set, so rotate and revoke are the only access control. There is no per-consumer identity and no ACL beyond the grant.
- Freshness has two paths: an automatic debounced republish when a relayed turn marks the share dirty (with a wake-time catch-up for pods that died dirty), and an explicit hard refresh that republishes now — available to both the owner from the UI and the KB's own agent through a platform MCP tool.

## Alternatives Considered

- **Proxy the live agent** — every foreign query would run the owner's LLM and pod, couple share availability to the owner's budget and hibernation, and expose a read path into a write-capable workspace.
- **Copy / re-ingest into each consumer** — duplicates storage and ingestion cost per consumer and drifts from the source the moment the owner curates.
- **Consume over the egress gateway / public share host** — agents cannot reach the share host in-cluster (a `*.localhost` dev host resolves to loopback; a real host needs a fragile public-LB hairpin, and the agent NetworkPolicy fences in-cluster targets), and the contract is strictly in-cluster traffic.
- **HMAC-only secret (the API-keys model)** — precludes durable re-copy of the share string, which is the owner-facing product contract.

## Consequences

- **Easier:** one curated KB serves many teams at zero marginal owner cost — no LLM or pod runs per consumer query, and a snapshot answers while the KB is hibernated, over budget, or stopped.
- **Easier:** read-only is structural, not policed — no code path from a consumer request reaches an agent, its PVC, or any write rail, so there is no ACL surface to get wrong; document reads resolve only through the snapshot manifest.
- **Harder:** shared content is only as fresh as the last successful publish, not live — bounding staleness requires the debounced republish and wake-time catch-up, and a failed republish leaves the previous snapshot serving.
- **Harder:** the share secret is stored retrievably rather than hashed — a deliberate weakening from the API-keys HMAC model, justified only by the re-copy contract, with rotation as the sole revocation lever.
- **Committed-to:** the object store is on the consumer read path (snapshots and index live there alongside artifacts), and the in-cluster harness route now carries a second consumer besides platform-outbound.
