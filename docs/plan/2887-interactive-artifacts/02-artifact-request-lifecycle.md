# 02 — Artifact Request lifecycle

**Depends on:** 01-interactive-flag-and-sharing
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

The record of one request, and every rule that governs it, with no agent involved yet. After this
slice a request can be created, read, cancelled, and failed, and the rules that protect the
owner (one in flight, hourly cap, ownership, named failures) are enforced. Delivery arrives in
04.

## Implementation plan

Apply the `/typescript-engineering` skill. Layering is the module's existing
domain / services / infrastructure split.

1. **Schema.** Add the `artifact_requests` table to
   [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts) exactly as pinned in the
   README, with an index on `(artifact_id, created_at)` for the rolling-hour count and a
   partial index or query supporting "is one in flight". `mise run db:generate`, with the
   why-comment.
2. **Domain.** New `domain/artifact-request.ts`: the state machine (`pending` → `delivered` →
   `answered` | `failed`), the failure-reason union, and the guards. Keep it pure — no db, no
   clock injection beyond a passed-in `now`.
3. **Repository.** `infrastructure/artifact-requests-repository.ts`: insert, get by id,
   settle (answer or fail), count in the last hour for an artifact, find in-flight for an
   artifact. Owner scoping on every read, as the rest of the module does.
4. **Service.** `services/artifact-requests-service.ts`:
   - `create` — verifies the artifact exists, is owned by the caller, is `interactive`, and is
     private. Then, in order: refuse `busy` if one is in flight, refuse `rate_limited` past 60
     in the rolling hour, otherwise insert with the next `seq`.
   - `get`, `cancel` (settles as `cancelled`), and an internal `fail(reason)` used by 04.
   - Raise a live event on every settle, and an [Activity Event](../../architecture/usage-tracking.md)
     **only when `trigger` is `user`** — an automatic request has no actor, so it must not reach
     the activity log. This mirrors the existing rule; do not invent a new one.
5. **Contract and wiring.** Add the `requests.*` procedures to
   [`router.ts`](../../../packages/api-server-api/src/modules/artifact-library/router.ts) under
   the same owner-scoped procedure the module already uses, the input/output schemas, and the
   `ArtifactRequestSettled` live event type. Compose the service in
   [`compose.ts`](../../../packages/api-server/src/modules/artifact-library/compose.ts).

## Acceptance criteria

- [ ] `mise run db:check:generated` passes; migration committed with its journal entry.
- [ ] `requests.create` refuses a non-interactive artifact, a public artifact, and another
      owner's artifact, each with a distinct error.
- [ ] A second create while one is in flight fails with `busy`, not a queue.
- [ ] The 61st create in an hour fails with `rate_limited`.
- [ ] `cancel` settles the request and raises the live event.
- [ ] A `user` request writes an activity event; an `auto` request writes none.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then drive the tRPC surface directly against the dev cluster:
create a request for an interactive artifact and read it back (`pending`), create a second and
see `busy`, cancel the first and see the state change. Confirm the owner event stream carries
the settle. No UI and no agent are involved yet — that is expected at this slice.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
