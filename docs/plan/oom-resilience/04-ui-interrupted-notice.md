# 04 — UI notice for interrupted sessions

**Depends on:** 03-boot-recovery
**Part of:** oom-resilience — see [README](./README.md)

## Context

An interactive session interrupted by a pod restart now reports
`_meta.platform.turn.interruptedAt` on `session/load`. This slice renders that in the session
view so the user knows the agent stopped because of a restart (not silently), mirroring how
undelivered prompts are surfaced.

## Implementation plan

Apply `/react-ui-engineering`.

1. `packages/ui/src/modules/acp/session-projection.ts`: where the load reply's
   `_meta.platform` is consumed (same place `turn.inFlight` drives `settleReplay` and
   `undelivered` drives `undeliveredBubble`s), when `turn.interruptedAt` is present and no
   turn is in flight, append a system notice message to the projection — e.g. a message with
   an `error`/notice variant carrying the timestamp.
2. Component: render it near where `UndeliveredNotice`
   (`packages/ui/src/modules/sessions/components/undelivered-notice.tsx`) renders — copy in
   the vein of: "The agent's previous turn was interrupted by an unexpected restart (likely
   out of memory). Its last actions may be incomplete — send a message to continue." No retry
   payload (there is no prompt to resend; the user's own undelivered prompts, if any, already
   have their notice).
3. Keep it one-shot per load: the notice reflects load-time meta; once the user sends a turn
   and the marker clears, the next load carries no `interruptedAt`.

## Acceptance criteria

- [ ] Load reply with `turn.interruptedAt` and `inFlight: false` renders exactly one notice
      at the transcript tail; without the field nothing renders.
- [ ] Existing UI unit tests green (`mise run ui:test`), lint/typecheck green.

## Smoke test

`mise run ui:test` and `mise run ui:check`. Manual: with the slice-03 dev-mode scenario
(interactive marker present), open the session in the UI and confirm the notice appears once
and disappears after completing a new turn and reloading.
