# 02 — Durable delegation record

**Part of:** Delegation visibility — see [README](./README.md)

## Context

The `invocations` row is the delegation record, but today it is thin and short-lived: it
holds driver, owner, schema, result, status, error and timestamps, and the liveness sweep
deletes it ten minutes after terminal. This slice implements ADR-093's first half: the row
stays for the root driver's lifetime, gains the fields the UI will show, and is removed by
the root driver's agent-scoped cleanup. Nothing about the child Agent's reaping changes.

Apply `/typescript-engineering`.

## Implementation plan

1. **Schema** — `packages/db/src/schema.ts:768-793`, table `invocations`. Add:
   `root_driver_id text not null` (backfill in the migration with `driver_agent_id`, which
   is correct for every row of depth one and the best available for older rows),
   `label text`, `prompt text not null default ''`, `template_id text`, `image text`,
   `connections jsonb not null default '[]'`, `cpu text`, `memory text`,
   `ttl_ms integer`. Add an index on `root_driver_id`. Keep the partial running index.
   Run `mise run //packages/db:generate`.
2. **Repository** — `packages/api-server/src/modules/invocations/infrastructure/invocations-repository.ts`.
   Extend `InvocationRow` with the new columns and with `createdAt` (the column exists but
   the row type drops it). Extend `insert`. Add `listByRoot(rootDriverId)`,
   `deleteByRoot(rootDriverId)`, `listDistinctRootDriverIds()`. Change
   `listTargetsByOwner` to running rows only: `spawnedBy` on the agents list is only
   meaningful for a live target, and the table is no longer bounded by the ten-minute
   window. Remove `listAgedTerminal` and `delete` once nothing calls them.
3. **Service** — `services/invocations-service.ts:154-172`. `resolveRoot` already runs
   before the insert; persist its result as `rootDriverId`. Persist `prompt` (the caller's
   text, not the built prompt), `templateId`, `image`, `connections`, `cpu`, `memory`,
   `ttlMs` and `label` from `SpawnInput`. Add `label?: string` to `SpawnInput`; slice 03
   wires it through the HTTP schema, so until then it is always undefined.
4. **Liveness sweep** — `services/invocation-liveness.ts:75-88`. Delete phase three and
   `RESULT_RETENTION_MS`. Phases one and two (deadline, pod restart) stay.
5. **Cleanup follows the root driver** — `services/driver-cascade.ts` and
   `compose.ts:75-90`. Keep the cascade as is. In the cleanup hook, after the cascade, if
   the deleted agent is not itself a target (`repo.get(agentId)` is null) call
   `repo.deleteByRoot(agentId)`. Extend `listInvocationAgentIds` so the orphan sweep
   (`packages/api-server/src/sagas/agent-artifacts-sweeper.ts`) also sees every distinct
   `root_driver_id`; keep returning running targets past the grace as today, and do not
   return terminal target ids (they are deleted on purpose and would churn every sweep).
6. **Docs** — `docs/architecture/agent-lifecycle.md`: where it describes the Invocation
   result row outliving the Agent for a short window, state instead that the record lives
   for the root driver's lifetime and goes with its cleanup. `docs/architecture/persistence.md`
   lifetime table: the Agent delete row gains the invocation records the Agent rooted. Update
   `Last verified` per the documentation guidelines. Check the page size cap.

## Acceptance criteria

- [ ] A spawned invocation's row carries root driver, prompt, template or image,
      connections, size, ttl and (once 03 lands) label.
- [ ] A terminal row is still present an hour later; the driver's poll still returns it.
- [ ] Deleting the root driver removes every row rooted at it, including a grandchild whose
      parent was reaped earlier.
- [ ] Deleting a mid-chain target (parent of a grandchild) removes no rows.
- [ ] `agents.list` still reports `spawnedBy` for running targets and nothing for finished
      ones.
- [ ] `mise run check` and `mise run test` pass; `mise run //docs:check` passes.

## Smoke test

`mise run test` (invocations unit tests cover the repository and the sweep) and
`mise run check`. Then on the dev cluster: run the README's fan-out prompt, wait fifteen
minutes, and confirm in Postgres (`kubectl` is wrapped by the cluster tasks; use the
cluster-ops skill) that both rows are still present with `root_driver_id` equal to the
driver and `prompt` filled. Delete the driver from the UI and confirm the rows are gone.
