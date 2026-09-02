---
id:
title: "Notifications as a per-owner attention record; the agent still owns session truth"
status: proposed
supersedes:
subsystem: agent-lifecycle
tags: [notifications, home, sessions, events]
summary: The platform stores what needs a user's attention, written by a lease-elected watcher pulling on pod notices, with seen and dismissed as per-user watermarks; the agent remains the sole source of truth for which sessions exist.
---

# ADR: Notifications as a per-owner attention record; the agent still owns session truth

**Date:** 2026-09-02
**Status:** Proposed
**Owner:** @kapetr

## Context

Home ships an activity feed of what needs a decision and what is still working. Approvals come from
Postgres; sessions come from the pod, live over the watch surface [ADR-086](086-pod-owned-live-updates.md)
built, with read state stored inside the pod and dismissals in browser local storage. Three gaps
remain that no amount of liveness closes: a hibernated agent contributes nothing, because the truth
is inside a pod that is not running; what a user dismissed is forgotten on their next device; and a
scheduled run that finished overnight leaves no server-side record at all.

[ADR-055](055-agent-owned-session-metadata.md) removed the Postgres sessions table on the grounds
that every consumer either speaks ACP to the agent or runs in-pod. Home is the first consumer that
breaks that premise: it reads across every agent at once, and it must answer while the pod is
asleep. That does not make 055 wrong, but it means the platform needs to keep something it
previously did not.

## Decision

The platform keeps a per-owner record of what needs attention — session activity, its outcome, and
whether it was seen — while the agent remains the sole source of truth for which sessions exist.
The record is written by a lease-elected watcher in the api-server that consumes the pod surface
ADR-086 built: it holds the session watch to every running agent, and on each notice re-reads the
pod's session list and upserts the record. Read and dismissed state move out of the pod and become
per-user watermarks on that record, so Home can answer "what did I miss" for a hibernated agent.

The boundary that keeps ADR-055 intact: **the record is never consulted to answer what sessions
exist.** A missing row means nobody was told, not that nothing happened. Nothing reads it for
correctness, so it may lag, and it may be rebuilt or discarded without data loss.

The rules that follow from it:

- **Attention only, and only where nothing else owns the fact.** Approvals already have a durable
  owner-scoped table and stay there — they get no record of their own. A record exists for a
  session because a session has no server-side row to point at.
- **One row per session, aggregating.** Activity updates the row rather than appending to it;
  history stays in the session transcript, which the agent already owns.
- **Seen and dismissed are watermarks, not flags.** The record is one row per session; seen and
  dismissed live beside it as one state row per user and session, each a timestamp. Unread means
  activity later than the seen mark; hidden means activity no later than the dismissed mark. New
  activity therefore returns a dismissed row without any explicit un-dismiss, and one user's
  dismissal hides nothing for another.
- **Seen is derived from presence, not declared by the client.** A turn relayed while a viewer is
  attached means the user was watching; a turn dispatched in-pod means they were not. Server-held
  streams and passive reads are not viewers and mark nothing. The pod's own read state is retired.
- **In progress is never stored.** Whether an agent is working now is read live from awake pods, so
  a pod that dies without notice cannot leave phantom work on the page.
- **The producer pulls; notices never carry state.** ADR-086's contract holds on the pod side too:
  a notice means re-read, and the watcher's read-then-upsert is the one write moment. The capture
  window is bounded by the hibernation timeout — a notice fires within milliseconds of a turn and
  the read completes at once, while hibernation follows minutes later — so a hard kill may lose the
  last item, and that is accepted.
- **The write moment feeds the standard pipeline.** The upsert emits a domain event; the live-hints
  saga projects it as an ordinary per-owner hint. The dedicated owner-wide session subscription
  ADR-086 added is then retired, and browsers stop holding per-agent reads for the feed.
- **Sessions pull, moments push.** The artifact-touch report stays a pod-initiated push because a
  touch is a moment whose data only the observed frame carries; a session record is state the pod
  can always re-serve, so it needs no push path of its own.

## Alternatives Considered

- **Mirror pod session state into Postgres** — reverses ADR-055 and restores the two-stores-disagree
  failure that replaced ADR-017; a mirror is consulted for truth, an attention record is not.
- **The pod pushes reports carrying payload** — this draft's original shape; rejected with ADR-086
  in place. It adds a pod→platform route, retry and shutdown-flush machinery for the same loss
  bound the pull design already has, and it violates 086's notices-never-carry-state contract.
- **Append one record per moment, immutably** — the feed shows one row per session, so the reader
  would collapse them anyway, and dismissal would need a version key to distinguish the moment
  dismissed from the next one.
- **Keep read state in the pod** — the state is a property of the user and the session together,
  not of the session, and a sleeping pod cannot answer for it.
- **A transactional outbox for the writer** — [ADR-083](083-eventing-layering.md) reserves that for
  a consumer whose loss no reconcile can bound; the watcher re-reads every pod on lease failover
  and the upsert's no-op guard suppresses the unchanged, which is that reconcile.
- **Reuse the activity event log** — its owner column is pseudonymized for usage analysis, and
  [persistence](../architecture/persistence.md) forbids extending it to serve a user-facing surface.

## Consequences

- **Easier:** Home answers for hibernated agents, which today show nothing at all. Dismissals
  follow the user across devices instead of living in one local store capped at 300 keys. The feed
  becomes one owner-scoped query plus the standard hint, replacing the per-agent pod reads and the
  dedicated session subscription browsers hold today.
- **Easier:** The store notifications need (#3100) and the store the feed needs are the same store,
  so a notification centre, channel push, and the floating pill read one source rather than three.
- **Harder:** An always-on watcher re-scopes ADR-086's "an unobserved agent generates no reporting
  traffic": an idle agent still emits nothing, but a busy agent now reports whether or not any
  human is watching. Recording is the point, but the promise narrows and should be stated, not
  inherited silently.
- **Harder:** Session titles now exist in two places — the agent's own metadata and this record's
  snapshot — so a renamed session shows its old title on Home until the next notice. ADR-055
  removed exactly this kind of duplication; the mitigation is that the copy is never read for
  correctness.
- **Harder:** Terminal sessions have no turn boundary, so "finished" has no meaning for them;
  surfacing them needs a quiet-period rule, and they are excluded from unread entirely today.
- **Committed-to:** The leader lease. A row-writing producer is the first consumer of ADR-086's
  surface where exactly-once matters, so the watcher is lease-elected — the trivial
  single-holder kind, with failover healed by re-reading every pod. And presence stays the
  definition of "seen": a future surface that reads a session without attaching a viewer will not
  mark it, and the rule has to be revisited rather than patched at the call site.

## Open Questions

- How long records are retained, and whether trimming removes rows the user has already seen or
  dismissed.
- Whether terminal sessions are in the first cut, and what quiet period counts as their activity
  boundary.
- Whether an agent's ownership can transfer, which decides if the owner stored on a record can go
  stale.
