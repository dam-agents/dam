# 03 — The watcher that writes it

**Depends on:** 02-record-and-read-path
**Part of:** Persist activity feed state reliably — see [README](./README.md)

## Context

The producer. A lease-elected watcher in the api-server holds the pod session watch to every
running agent install-wide and, on each notice, re-reads that agent's session list and upserts
the record. This is the first consumer of ADR-086's surface where exactly-once matters, which is
why it takes a lease — a demand-driven holder needs none, a row-writing producer does. Apply
`/typescript-engineering`.

## Implementation plan

1. **Move the pod watch client, don't copy it.**
   `packages/api-server/src/modules/live-events/infrastructure/pod-session-watch.ts` already
   opens a tRPC WebSocket to a pod and validates notices against the pod's schema. Move it to
   `packages/api-server/src/modules/attention/infrastructure/pod-session-watch.ts` and re-point
   its current importer (`modules/live-events/compose.ts`) at the new location — sub-issue 04
   deletes that importer entirely. Add a `list(agentId)` alongside `watchAgent(...)` that calls
   the pod's `sessions.list` over the same client, so the watcher reads and watches through one
   place.

2. **The watcher.**
   `packages/api-server/src/modules/attention/services/session-watcher.ts` —
   `createSessionWatcher({ agentsRepo, podWatch, repo, log })` with `start()` / `stop()`:
   - Enumerate agents install-wide from `AgentsRepository.list()` (no owner argument) and keep
     the ones that are running and streamable — the same `agentStreamable` filter and
     `features.liveUpdates` check `modules/live-events/services/pod-sessions-service.ts` uses.
     Read that file first: its reconcile loop, re-entrancy guards and retry timer are the shape
     to follow, minus the per-owner holder bookkeeping, because this watcher is install-wide.
   - Hold one watch per such agent. Reconcile the set when agents change — subscribe to the same
     signal `pod-sessions-service` consumes for `agents`/`sync` — and on a slow interval as a
     backstop.
   - On a notice, debounce per agent (250 ms, matching the pod's own coalescing), then
     `list(agentId)` and capture.
   - Agents whose runtime predates live updates cannot be watched: poll them with `list(agentId)`
     on a 15-second interval instead, so their records do not silently freeze. Log once per agent
     when it falls back.

3. **Capture.**
   For each session the pod returns, build a record row: `ownerSub` from the agent, `mode`,
   `type`, `title`, `scheduleId`, `experimentId`, `createdAt`, `activityAt` from the session's
   `updatedAt`, `seenAt` from the session's `seenAt`, and `working` from `running`. Include
   terminal sessions — sub-issue 06 makes their activity stamp meaningful, and recording them now
   means nothing to backfill later.

   Guard every write with `sameRecord` from the module's domain types: read what is stored for
   the agent, compare semantically, and skip the write entirely when nothing changed. An idle
   agent that notices for an unrelated reason must produce no writes and no events.

4. **The write moment feeds the standard pipeline.**
   - Add `AttentionChanged` to `EventType` in `packages/api-server/src/events.ts`, carrying
     `ownerSub` and `agentId`, and `emit` it once per capture that actually wrote something.
   - Add `{ topic: "attention", agentId }` to `liveEventSchema` in
     `packages/api-server-api/src/modules/events/schemas.ts`.
   - Map the event to that hint in `packages/api-server/src/modules/live-events/sagas/live-hints.ts`.
   - Add an `attention` entry to `packages/ui/src/modules/live-events/invalidation.ts` pointing at
     the attention query key, so a hint re-reads the feed.

5. **Elect it.**
   In `packages/api-server/src/bootstrap.ts`, compose the watcher and add a role to the array
   passed to `createLeaderLease` beside `channels` and `live-events-agent-watch`:
   `{ name: "attention-watcher", onAcquired: () => watcher.start(), onLost: () => watcher.stop() }`.
   Read the doc comment at the top of `packages/api-server/src/core/leader-lease.ts` first — one
   lease, one campaign, several roles, and every role starts and stops together. Stop the watcher
   in `cleanup()` alongside the other lifecycle teardown.

   Failover needs no extra machinery: a new holder re-reads every running agent, and the no-op
   guard suppresses everything unchanged. That re-read *is* the reconcile this design promises
   instead of an outbox.

## Acceptance criteria

- [ ] A turn on a running agent produces a matching row within a second or two, without a browser
      anywhere — no tab open, no subscriber.
- [ ] Hibernating that agent leaves the row intact and unchanged.
- [ ] A second capture with nothing changed performs no write: `captured_at` does not move.
- [ ] Killing the leader replica moves the role within the lease TTL, and the new holder's re-read
      leaves rows unchanged.
- [ ] An agent whose runtime lacks live updates still gets rows, via the poll path.
- [ ] The hint arrives on `events.owner` with topic `attention` when a capture writes.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

On the dev cluster, with no browser open:

```
mise run cluster:build-apiserver
mise run cluster:logs | grep -i "leader\|attention"          # role acquired
```

Drive a turn — the schedule path is the honest one, since it needs no viewer — then:

```
mise run cluster:kubectl -- exec pod/platform-postgres-0 -- psql -U platform -d platform \
  -c "select agent_id, session_id, title, activity_at, working, captured_at from attention_records order by activity_at desc limit 5;"
```

Run it twice a minute apart with the agent idle: `captured_at` must not move. Then hibernate the
agent and confirm the row survives — that is the whole point of the feature, visible for the
first time here.
