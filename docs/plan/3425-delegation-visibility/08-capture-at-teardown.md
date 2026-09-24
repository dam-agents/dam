# 08 — Capture the child conversation at teardown

**Depends on:** 07-session-frames-out-of-pod, 10-reap-grace
**Part of:** Delegation visibility — see [README](./README.md)

## Context

The child's conversation lives on the child's volume and is reclaimed with it. ADR-093
keeps a copy: before every reap, read the frames out of the pod and store them through the
artifact store, key on the record. Capture is best effort and bounded; it never blocks
`report_result`, never fails a reap, and a child that does not answer yields a record with
no conversation. This is the first place the platform stores a session transcript outside
the harness's own store, so the persistence page changes too.

Apply `/typescript-engineering`.

## Implementation plan

1. **Schema** — `packages/db/src/schema.ts` `invocations`: add `transcript_key text` and
   `transcript_truncated boolean not null default false`. `mise run //packages/db:generate`.
   Repository: `setTranscript(id, key, truncated)`, and `deleteByRoot` now also returns the
   keys it removed so the caller can purge blobs.
2. **Store port** — in the invocations module declare
   `TranscriptStore = Pick<ArtifactService, "put" | "delete" | "maxBytes">`, the same
   structural narrowing kb-shares uses (`kb-shares/compose.ts:54-57`). Inject the `artifacts`
   singleton from `bootstrap.ts` where the invocations services are composed (harness app
   and cleanup hook). Key shape: `invocations/<owner>/<id>/frames.jsonl`, content type
   `application/x-ndjson`, one frame per line. If the joined frames exceed `maxBytes`, keep
   the newest lines that fit and set `truncated`.
3. **Capture service** — `services/target-capture.ts`: `capture(invocationId, owner)` reads
   via the slice 07 port, stores, stamps the record. Every step in its own try/catch;
   failures go to stderr with the invocation id and the capture returns normally. Wall
   clock budget 20 s end to end.
4. **Call it inside the reap path** — slice 10's `services/target-reaper.ts` `reap()`: capture
   first, then delete, then mark reaped. That covers the report path, the liveness sweep and
   its backstop, and the driver cascade with one insertion. In the cascade the pod may already
   be going, so the 15 s client timeout from slice 07 bounds it.
5. **Cleanup** — the cleanup hook from slice 02 deletes the rows by root; extend it to
   delete each returned `transcript_key` through the store, logging and continuing on
   failure, the way kb-shares purges share objects.
6. **Read path** — slice 04's mapper sets `transcriptAvailable = transcriptKey !== null`.
7. **Docs** — `docs/architecture/persistence.md`: object store row of the lifetime table
   gains "captured invocation conversations, purged with the root driver"; the paragraph
   stating sessions are never read from anywhere but the pod gets the one exception and why
   (the read-only copy of a deleted child). `docs/architecture/agent-lifecycle.md` Invocation
   reaping: one sentence, capture before reap, best effort. Update `Last verified`; check
   the size cap and raise the level rather than trim if it trips.

## Acceptance criteria

- [ ] After the README fan-out, both rows carry a `transcript_key` and the bucket holds an
      object per key whose last frame is the `report_result` tool call.
- [ ] A child that hits its liveness deadline without ever starting a session yields a row
      with `transcript_key` null and status `failed`; the reap still happens.
- [ ] With the object store unconfigured (`createUnconfiguredArtifactStore`) spawns and
      reaps behave exactly as before and no error reaches the driver.
- [ ] Deleting the root driver removes the objects along with the rows.
- [ ] `mise run check`, `mise run test` and `mise run //docs:check` pass.

## Smoke test

`mise run test` and `mise run check`. On the dev cluster run the README prompt, then list
the bucket prefix `invocations/<owner>/` (cluster-ops skill for the object store access)
and confirm two objects. Spawn one child with a ttl of one minute on an image without a
model connection so it never reports; confirm it is failed and reaped with no object. Delete
the driver and confirm the prefix is empty.
