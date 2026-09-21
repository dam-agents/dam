# 04 — Delegation read path

**Depends on:** 02-durable-record
**Part of:** Delegation visibility — see [README](./README.md)

## Context

Invocations have no user-facing read today; the only surface is the harness poll endpoint
the SDK uses, and the `listTargets` query the agents router folds into `spawnedBy`. This
slice adds the owner-scoped tRPC read the Delegation block will call: given a driver and the
ids found in its chip, return those delegations as a tree with children nested.

Apply `/typescript-engineering`.

## Implementation plan

1. **Contract** — `packages/api-server-api/src/modules/invocations/`. Add `types.ts` with
   `DelegationNode` exactly as pinned in the README, `schemas.ts` gains the `tree` input
   schema (`driverAgentId`, `ids` max 200), and a new `router.ts` with
   `tree: readAgentProcedure.input(...).query(...)` that first calls
   `checkAgentBinding(ctx, input.driverAgentId)` (pattern: `agents/router.ts:47-58`).
   Register it in `packages/api-server-api/src/router.ts` under `invocations`.
2. **Query service** — extend `InvocationsQueryService`
   (`packages/api-server/src/modules/invocations/compose.ts:47`) with
   `tree(driverAgentId, ids)`. Resolve the driver's root: if `repo.get(driverAgentId)` is a
   row, use its `rootDriverId`, else the driver is the root. Fetch `repo.listByRoot(root)`,
   keep rows whose `owner` matches, build parent → children in memory, and return the
   subtrees for the requested ids in request order. An id not in the set is dropped. Map
   rows to `DelegationNode` in a domain mapper (`domain/delegation-node.ts`); `result` is
   null while running; `transcriptAvailable` is false until slice 08; `title` is the label,
   else the prompt's first line cut to 120 characters (README, Design § Title rule).
3. **Context** — `ctx.invocationsQuery` is already composed per owner
   (`packages/api-server/src/apps/api-server/trpc/context.ts:186`); the new method rides it.
4. **Bound the read.** `listByRoot` is bounded by the root's lifetime, which is fine for a
   tree read but not for a hot path. Add a `limit` (2000) and log when hit; the UI shows
   what it gets.

## Acceptance criteria

- [ ] `invocations.tree` for a driver and two of its child ids returns two nodes with the
      README fields filled, in request order.
- [ ] A grandchild appears nested under its child, not at the top level.
- [ ] An id that belongs to another owner's driver, or was never spawned, is absent.
- [ ] A caller whose API key is not bound to the driver gets `FORBIDDEN`.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run test` and `mise run check`. Then against the dev cluster, with the driver from
the README prompt: call `invocations.tree` from the browser devtools of the running UI
(`api.invocations.tree.query({ driverAgentId, ids })` on the tRPC client exported by
`packages/ui/src/api.ts`, reachable through the module in the devtools sources) and read
the two nodes back with status `done` and results `42` and `72`.
