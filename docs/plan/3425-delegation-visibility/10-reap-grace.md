# 10 — A grace before reaping a reported target

**Depends on:** 02-durable-record
**Part of:** Delegation visibility — see [README](./README.md)

## Context

A target is deleted the instant `report_result` lands, and that delete stops the child pod
and its gateway together. Slice 08 has to read the child's conversation out of that pod
before it goes, and today there is no single place to hook that into: the report path, the
liveness sweep and the driver cascade each delete the target themselves. This slice gives
them one reap path, and puts a short pause between a target reporting and its deletion so
nothing in flight is cut off mid-word.

**What this slice does not fix.** It was written believing it would recover the telemetry
that goes missing on some children. Measurement on 2026-09-24 disproved that: across fifteen
children the records were never in flight at teardown at all (see the README's open
question). The pause stays as cheap insurance and as the seam slice 08 needs, not as a cure.

Apply `/typescript-engineering`.

## Implementation plan

1. **Schema** — `packages/db/src/schema.ts` `invocations`: add `reaped_at timestamptz`
   (null until the target delete was issued). `mise run //packages/db:generate`. Repository:
   `markReaped(id)`, and `listTerminalUnreaped(before, limit)` selecting `done` or `failed`
   rows with `reaped_at is null` and `completed_at < before`, with a partial index on
   `completed_at where reaped_at is null`.
2. **One reap path** — `services/target-reaper.ts`: `reap(row, { immediate })`. It deletes the
   target Agent through the owner's agents service and marks the row reaped; failures are
   logged and leave `reaped_at` null so the sweep retries. Slice 08 inserts the conversation
   capture at the top of this function. `REPORT_GRACE_MS = 5_000`.
3. **Report** — `services/invocations-service.ts` `recordResult`: after `repo.complete`, no
   delete. Schedule `reap` after the grace with a timer that does not hold the process open
   (`unref`). The MCP response returns at once, as today.
4. **Sweep backstop** — `services/invocation-liveness.ts` gains a phase: rows from
   `listTerminalUnreaped(now - REPORT_GRACE_MS)` are reaped, which covers an api-server that
   restarted between report and timer. `failAndReap` (deadline, pod restart) keeps its
   immediate delete but goes through the same `reap` so it marks the row.
5. **Driver cascade** — `services/driver-cascade.ts` keeps deleting children immediately
   through `reap({ immediate: true })`: a deleted driver's targets must not keep running
   against its egress identity, and that rule outranks their telemetry.
6. **Docs** — `docs/architecture/agent-lifecycle.md` where the Agent Sweep and eager reaping
   are described: a reported target is reaped after a short grace so its last telemetry batch
   lands, with the liveness sweep as backstop. `docs/architecture/observability.md` § Trusted
   attribution: one sentence that target telemetry is complete only because reaping waits
   for the export interval. Update `Last verified`; mind the size caps.

## Acceptance criteria

- [ ] Every path that reaps a target goes through one function, so slice 08 has a single
      place to insert the capture.
- [ ] A reported target's pod is gone within roughly ten seconds of its report.
- [ ] Killing the api-server between a report and the grace still ends with the target
      deleted and `reaped_at` set, by the next sweep tick.
- [ ] Deleting a driver still removes its running children immediately.
- [ ] `mise run check` and `mise run test` pass (the liveness and result-coercion unit tests
      adapt to the new path).

## Smoke test

`mise run test` and `mise run check`. On the dev cluster run the README fan-out prompt and
watch `mise run cluster:kubectl -- -n platform-agents get pods -w`: child pods disappear a
few seconds after the driver prints `[invoke] done`, and the rows carry a `reaped_at` a few
seconds past their `completed_at`. Verified 2026-09-24: completion and reap were identical
timestamps before this slice and five to seven seconds apart after it.
