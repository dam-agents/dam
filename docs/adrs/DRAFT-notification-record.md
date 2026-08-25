---
id:
title: "Notifications as a per-owner attention record; the agent still owns session truth"
status: proposed
supersedes:
subsystem: agent-lifecycle
tags: [notifications, home, sessions, events]
summary: The platform stores what needs a user's attention, with seen and dismissed as per-user watermarks, while the agent remains the sole source of truth for which sessions exist.
---

# ADR-084: Notifications as a per-owner attention record; the agent still owns session truth

**Date:** 2026-08-25
**Status:** Proposed
**Owner:** @kapetr

## Context

Home ships an activity feed of what needs a decision and what is still working. It reads approvals from Postgres, but reads sessions by opening an ACP connection to every running agent on a timer, and keeps dismissals in browser local storage. That leaves three gaps the feature exists to close: a hibernated agent contributes nothing, because the truth is inside a pod that is not running; what a user dismissed is forgotten on their next device; and the case the feed was built for — a scheduled run that finished overnight — produces no server-side record at all, since a turn dispatched in-pod traverses no relay.

[ADR-055](055-agent-owned-session-metadata.md) removed the Postgres sessions table on the grounds that every consumer either speaks ACP to the agent or runs in-pod. Home is the first consumer that breaks that premise: it reads across every agent at once, and it must answer while the pod is asleep. That does not make 055 wrong, but it does mean the platform needs to keep something it previously did not.

## Decision

The platform keeps a per-owner record of what needs attention — session activity, its outcome, and whether it was seen — while the agent remains the sole source of truth for which sessions exist. Read and dismissed state move out of the pod and become per-user watermarks on that record, so Home can answer "what did I miss" for a hibernated agent.

The boundary that keeps ADR-055 intact: **the record is never consulted to answer what sessions exist.** A missing row means nobody was told, not that nothing happened. Nothing reads it for correctness, so it may lag, and it may be rebuilt or discarded without data loss.

The rules that follow from it:

- **Attention only, and only where nothing else owns the fact.** Approvals already have a durable owner-scoped table and stay there — they get no record of their own. A record exists for a session because a session has no server-side row to point at.
- **One row per session, aggregating.** Activity updates the row rather than appending to it; history stays in the session transcript, which the agent already owns.
- **Seen and dismissed are watermarks, not flags.** Unread means activity later than the seen mark; hidden means activity no later than the dismissed mark. New activity therefore returns a dismissed row without any explicit un-dismiss.
- **Seen is derived from presence, not declared by the client.** A turn relayed while a client is attached means the user was watching; a turn dispatched in-pod means they were not. Both relays already know this, so the pod's read state and its `platform/markSeen` handler are retired.
- **In progress is never stored.** Whether an agent is working now is read live from awake pods, so a pod that dies without notice cannot leave phantom work on the page.
- **The pod carries the payload when it reports.** Reading the feed must never wake an agent, and a report that only says "something changed" would race with the pod shutting down.
- **Delivery is best-effort, bounded by shutdown.** The pod retries its report and flushes before exiting; a hard kill may lose the last item. No transactional outbox is introduced.
- **Artifacts are attributed, not copied.** A produced artifact is found by querying artifact versions for the session, which requires the session to be known at write time. Today nothing knows it: the harness calls the platform's MCP server directly, and that endpoint sees only an agent. Session-scoped MCP attribution is a prerequisite of showing artifacts on the feed, not part of this decision.

## Alternatives Considered

- **Mirror pod session state into Postgres** — reverses ADR-055 and restores the two-stores-disagree failure that replaced ADR-017; a mirror is consulted for truth, an attention record is not.
- **Append one record per moment, immutably** — the feed shows one row per session, so the reader would collapse them anyway, and dismissal would need a version key to distinguish the moment dismissed from the next one.
- **Keep read state in the pod** — the state is a property of the user and the session together, not of the session, and a sleeping pod cannot answer for it.
- **Push notification payloads over the existing socket** — [ADR-083](083-eventing-layering.md) requires cross-replica signals to stay thin with consumers re-reading the store; a hint plus a read keeps one code path and no ordering problem.
- **A transactional outbox for reports** — ADR-083 reserves that for a consumer whose loss no reconcile can bound; a pod that retries before shutting down bounds it, and a hard kill loses at most the final item.
- **Reuse the activity event log** — its owner column is pseudonymized for usage analysis, and [persistence](../architecture/persistence.md) forbids extending it to serve a user-facing surface.

## Consequences

- **Easier:** Home answers for hibernated agents, which today show nothing at all — sessions are read only from agents in the running state. Dismissals follow the user across browsers instead of living in one local store capped at 300 keys. The feed becomes one owner-scoped query instead of one ACP WebSocket per running agent every 15 seconds.
- **Easier:** The store notifications need (#3100) and the store the feed needs are the same store, so a notification centre, channel push, and the floating pill read one source rather than three.
- **Harder:** Session titles now exist in two places — the agent's own metadata and this record's display snapshot — so a renamed session shows its old title on Home until the next report. ADR-055 removed exactly this kind of duplication, and the mitigation is that the copy is never read for correctness.
- **Harder:** Terminal sessions have no turn boundary, so "finished" has no meaning for them; surfacing them needs a quiet-period rule rather than an output signal, and they are excluded from unread entirely today.
- **Harder:** The producer is the pod, so this depends on the pod-to-platform reporting surface being designed in #3307, and on session-scoped MCP attribution before artifacts can appear.
- **Committed-to:** Presence as the definition of "seen". If a future surface reads a session without attaching a relay, it will not mark anything seen, and the rule has to be revisited rather than patched at the call site.

## Open Questions

- How long records are retained, and whether trimming removes rows the user has already seen or dismissed.
- Whether terminal sessions are in the first cut, and what quiet period counts as their activity boundary.
- Whether an agent's ownership can transfer, which decides if the owner stored on a record can go stale.
