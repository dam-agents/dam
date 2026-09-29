# 08 — Capture the child conversation at teardown

**Depends on:** 07-session-frames-out-of-pod, 10-reap-grace
**Part of:** Delegation visibility — see [README](./README.md)

## Context

The child's conversation lives on the child's volume and is reclaimed with it. ADR-094
keeps a copy on the **root driver's** volume, where the root's own sessions live: before
every reap, read the frames out of the child's pod and hand them to the root's runtime,
which writes them under `.platform/delegations/`. The record notes that it was captured.
Capture is best effort and bounded; it never blocks `report_result`, never fails a reap,
never wakes the root, and a child or root that does not answer yields a record with no
conversation. Retention comes with the root's volume, so there is no purge.

Apply `/typescript-engineering`.

## Implementation plan

1. **Schema** — `packages/db/src/schema.ts` `invocations`: add
   `transcript_captured boolean not null default false` and
   `transcript_truncated boolean not null default false`. `mise run //packages/db:generate`.
   Repository: `markTranscriptCaptured(id, truncated)`.
2. **Runtime store** — `packages/agent-runtime-api` sessions module gains
   `storeDelegationFrames({ invocationId, frames, truncated })` and
   `delegationFrames({ invocationId }) -> { frames } | null`, the id validated as an agent
   id; the store answers `{ truncated }`. `packages/agent-runtime` writes one file per
   child, `.platform/delegations/<id>.jsonl`, one frame per line, atomically. Each file
   keeps the newest frames within 4 MiB; the directory is capped at 64 MiB, evicting the
   oldest files, never the one written. No age limit: the copies go with the volume.
3. **Port** — `services/delegation-frames.ts` `DelegationFramesPort`: `readFromTarget`
   (slice 07's read), `storeOnRoot`, `readFromRoot`. The pod client implements it; every
   call answers `null`/`false` on failure. `storeOnRoot` checks `agentsRepo.isReady(root)`
   first and skips a root that is not up, so capture never wakes it.
4. **Capture service** — `services/target-capture.ts`: `capture(row)` resolves the row's
   `rootDriverId`, reads the child's frames, stores them on the root, stamps the record.
   Failures go to stderr with the invocation id and the capture returns normally. Wall
   clock budget 20 s end to end.
5. **Call it inside the reap path** — slice 10's `services/target-reaper.ts` `reap()`:
   capture first, then delete, then mark reaped. That covers the report path, the liveness
   sweep and its backstop, and the driver cascade with one insertion. When the cascade
   deletes the root itself it reaps without capture, since the root's volume goes too.
6. **Read path** — slice 04's mapper sets `transcriptAvailable = transcriptCaptured`.
7. **Docs** — `docs/architecture/persistence.md`: the `.platform/` directory gains the
   delegations folder. `docs/architecture/agent-lifecycle.md` Delete: one sentence,
   capture before reap, best effort, only while the root is up. Update `Last verified`;
   raise the level rather than trim if a size cap trips.

## Acceptance criteria

- [x] After the README fan-out, both rows carry `transcript_captured` and the root's
      `.platform/delegations/` holds a `.jsonl` file per child that holds its prompt,
      its `report_result` tool call and its closing message.
- [x] A child that hits its liveness deadline without ever starting a session yields a row
      with `transcript_captured` false and status `failed`; one whose session started but
      never answered is captured with its prompt alone. The reap happens either way.
- [ ] A root that is not up at capture is not woken; the row stays uncaptured and the reap
      still happens.
- [x] Deleting the root driver removes the rows; the copies go with its volume.
- [x] `mise run check`, `mise run test` and `mise run //docs:check` pass.

## Smoke test

`mise run test` and `mise run check`. On the dev cluster run the README prompt, then list
`~/.platform/delegations/` in the root's pod and confirm two files, and the rows' flags.
Spawn one child with a ttl of one minute and no model connection so it never reports;
confirm it is failed and reaped with no file. Stop the root while a child runs; confirm the
child is reaped uncaptured and the root stays down.
