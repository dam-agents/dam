# 01 — Session pins on the server

**Part of:** Left nav: one list of sessions — see [README](./README.md)

## Context

Per-user pins of sessions, stored by the api-server so they follow the user to every browser, and read together with the same attention rows Activity shows so a pinned row never wakes its Agent. Backend only; the UI uses it in 04. The contract is fixed in the README (`sessionPins`).

## Implementation plan

Apply `/typescript-engineering`. Model every layer on the `sidebar-order` module.

1. **Table** in `packages/db/src/schema.ts`, beside `sidebarAgentOrder`: `session_pins` with `owner text`, `agent_id text`, `session_id text`, `pinned_at timestamptz default now()`; primary key `(owner, agent_id, session_id)`; index on `agent_id`. Generate the migration as `packages/db/README.md` describes (tables are generated) and export the table from `packages/db/src/index.ts`.
2. **Contract** in `packages/api-server-api/src/modules/session-pins/`: `types.ts` (`SessionPin`, `SessionPinList`, `SessionPinsService` with `list`, `pin`, `unpin`), `schemas.ts` (`{ agentId, sessionId }`, both `z.string().min(1)`), `router.ts` (`list` on `readAgentProcedure.use(requireWildcardBinding)`, `pin`/`unpin` on `browserOnlyProcedure`, as `sidebar-order/router.ts`). Register `sessionPins` in `src/router.ts`, the service in `src/context.ts`, export from `src/index.ts`.
3. **Module** `packages/api-server/src/modules/session-pins/` (`compose.ts`, `index.ts`, `infrastructure/session-pins-repository.ts`, `services/session-pins-service.ts`):
   - `list(owner)`: one query, `session_pins` left-joined to `attention_records` on `(owner_sub = owner, agent_id, session_id)` without the feed's `notDismissed` filter (a pin is not a feed item); map the row with the attention module's `toItem` (export it, don't copy it). Order by `coalesce(activity_at, created_at)` desc nulls last, then `pinned_at` desc.
   - `pin`: allowed when the caller owns the Agent or holds `sessions` on it as an Agent Editor — reuse the check behind `apps/api-server/agent-proxies/editor-runtime-access.ts`; otherwise `FORBIDDEN`. Insert on conflict do nothing.
   - `unpin`: delete; no access check beyond the owner key.
   - `deleteForAgent(agentId)`, `listAgentIds()`, `deleteSessions(agentId, sessionIds)` for cleanup.
4. **Wiring** in `packages/api-server/src/bootstrap.ts`: compose beside `composeSidebarOrderModule` (~l.1550); add a `session-pins` entry to `agentCleanupSources` (~l.2597); pass `forOwner(user.sub)` into the tRPC context (`apps/api-server/trpc/context.ts`, beside `sidebarOrder`) and the deps (`apps/api-server/deps.ts`).
5. **Session gone:** in `modules/attention/services/session-watcher.ts` (~l.158), where `deps.repo.deleteSessions(agentId, gone)` runs, also drop the pins of those sessions through a port the watcher receives from `compose.ts` (keep attention independent of the pins module — a callback `onSessionsGone`).
6. **Retention:** `deleteOlderThan` in `modules/attention/infrastructure/attention-repository.ts` keeps a row whose `(agent_id, session_id)` has a pin by its `owner_sub` (`not exists` on `session_pins`).
7. **Docs:** add a _Pinned sessions_ paragraph to `docs/architecture/home-feed.md` (pins are a per-user list, never proof a session exists, read with the attention row, skipped by retention, dropped with the session or Agent), and `session_pins` to the api-server tables in `docs/architecture/persistence.md` (not kept on purpose).

## Acceptance criteria

- [ ] `sessionPins.pin` then `sessionPins.list` returns the pin with its attention `item` (title, activity time) for an owned Agent; `item` is `null` for a pin on a Shared Agent.
- [ ] Pinning twice is a no-op; unpinning an absent pin succeeds.
- [ ] Pinning on an Agent the caller neither owns nor holds `sessions` on is `FORBIDDEN`.
- [ ] Deleting the Agent removes its pins (cleanup source); a session the watcher sees gone loses its pins.
- [ ] Retention leaves a pinned row older than 90 days in place and still deletes unpinned ones.
- [ ] `mise run test` and `mise run check` (with `check:format`, `check:lint`) pass; the migration applies on a fresh database.

## Smoke test

Backend-only slice (README → tRPC contract); its end-to-end check is 04's smoke test.

1. `mise run test` and `mise run check` for `api-server`, `api-server-api` and `db` pass with the existing suite.
2. `mise run cluster:install` (or rebuild the api-server on a running cluster): the api-server starts, its log shows the new migration applied, and `\d session_pins` in the cluster's Postgres shows the table with its primary key and `agent_id` index.
3. The `attention-retention` job's next run logs as before (no error from the new `not exists`).

Then print a short manual guide for the user with those three checks.
