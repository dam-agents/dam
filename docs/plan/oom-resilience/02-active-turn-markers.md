# 02 — Durable active-turn markers

**Part of:** oom-resilience — see [README](./README.md)

## Context

A turn in flight exists only in the prompt scheduler's memory (`activeTurns` map), so an
abnormal pod death leaves no trace of it. This slice writes a durable marker per active turn
into a `.platform/` document so the next boot can tell which sessions were interrupted. The
marker contract (shape, lifecycle, origin predicate) is pinned in the README.

## Implementation plan

Apply `/typescript-engineering`.

1. New `packages/agent-runtime/src/modules/acp/infrastructure/active-turn-store.ts`, modeled
   on `undelivered-prompt-store.ts`: document name `active-turns`, zod schema per the README
   contract, API:
   - `record(sessionId, origin: "machine" | "interactive")` — upsert with `startedAt: now()`,
     preserving an existing entry's `attempts` (a recovery turn re-records its own session).
   - `clearCompleted(sessionId)` — remove the entry.
   - `purge(sessionId)` — remove unconditionally (session delete).
   - `leftovers(): Array<{ sessionId, startedAt, origin, attempts }>` — read all.
   - `bumpAttempts(sessionId)`.
   - `clearAll()` — for graceful shutdown.
2. Wire in `composeAcp` (`packages/agent-runtime/src/modules/acp/compose.ts`): create the
   store from `opts.stateBackend`, pass into `createAcpRuntime` deps, and return it from
   `composeAcp` (slice 03 consumes it in `server.ts`).
3. In `acp-runtime.ts`:
   - `onTurnStarted`: alongside the existing `startRun` logic, compute origin with the same
     predicate and `record(sessionId, origin)`.
   - Turn completion: the scheduler's `onTurnEnded` also fires on drop paths (`forget`,
     `clear`) where the turn was *lost*, not completed — those must keep the marker. Extend
     `PromptSchedulerDeps.onTurnEnded` to `onTurnEnded(sessionId, cause: "completed" | "dropped")`
     (`onPromptResponse` passes `"completed"`; `forget`/`clear` pass `"dropped"`), and call
     `clearCompleted` only for `"completed"`. `finishRun` keeps firing for both, as today.
   - Session delete path (where `undeliveredPrompts`/metadata are purged, ~`acp-runtime.ts:738`):
     also `purge(sessionId)`.
4. Graceful shutdown (`server.ts` `gracefulShutdown`): call `activeTurns.clearAll()` — SIGTERM
   means hibernation or a deliberate stop; those interruptions are by design and must not
   auto-resume. (Reached via the store returned from `composeAcp`.)

## Acceptance criteria

- [ ] Marker written when a turn starts, removed when that turn completes.
- [ ] Marker survives `scheduler.clear()` (harness death) and `forget` of an active turn.
- [ ] Marker removed on session delete and on SIGTERM shutdown.
- [ ] Existing agent-runtime tests green (`onTurnEnded` signature change is compile-checked
      across its call sites).

## Smoke test

`mise run agent-runtime:test` and `mise run agent-runtime:check`. Manual: in a dev-mode run
(`PLATFORM_DEV`), start a prompt and `kill -9` the runtime mid-turn; confirm
`working-dir/.platform/active-turns.json` holds the session's marker; restart, complete a
turn, confirm it clears.
