# 06 — Unread for terminal sessions

**Depends on:** 05-dismissals
**Part of:** Persist activity feed state reliably — see [README](./README.md)

## Context

Terminal sessions are excluded from unread everywhere, on the belief that we cannot tell whether
one has been seen. The pod can tell: a terminal session admits at most one WebSocket, so
`slot.client` is an unambiguous "somebody is looking", and `markTerminalSeen` already stamps seen
only while that viewer is attached, once on detach, and again on reattach.

What is missing is the other half. No PTY path calls `recordActivity`, so a terminal session's
`lastActivityAt` never moves, its composed `updatedAt` falls back to whatever the harness reports,
and `activity > seen` could never fire. This slice adds that stamp for output produced while
nobody is attached, and removes the exclusions. Apply `/typescript-engineering` for the pod and
`/react-ui-engineering` for the UI.

## Implementation plan

1. **Stamp activity on detached output.** In `packages/agent-runtime/src/server.ts`:
   - add `lastActivityStampAt: number` to `PtySlot` and a
     `PTY_ACTIVITY_STAMP_DEBOUNCE_MS = 10_000` beside the existing
     `PTY_SEEN_STAMP_DEBOUNCE_MS`;
   - in `pty.onData`, in the branch where `slot.client` is absent, call
     `sessionMetadata.recordActivity(sessionId)` at most once per debounce window, creating the
     metadata entry first if there is none, exactly as `markTerminalSeen` does.

   Only the detached case stamps: while a viewer is attached the session is being watched, and
   stamping activity there would race the seen stamp in the same handler for no gain.

   The store is wrapped by `notifyingSessionMetadataStore`, so this write raises a session-watch
   notice on its own — the watcher from sub-issue 03 then captures it with no further wiring.

2. **Let the feed show them.** In `packages/ui/src/modules/home/lib/unread.ts`, drop the
   `SessionMode.Terminal` early return from `isUnreadSession` and the matching exclusion in
   `isFeedableSession`. The seven-day window stays.

3. **Check the card reads sensibly.** A terminal session usually has no title, so
   `feed-card.tsx` renders its "Session" fallback and the terminal icon; confirm the session
   opens into the terminal surface rather than the chat one when clicked.

4. **Leave the liveness rule alone.** "Still working" for a terminal session already comes from
   the pod's output window via `running`, which the record carries as `working` — no quiet-period
   rule is needed, and none should be added.

## Acceptance criteria

- [ ] Detaching from a terminal session that keeps printing marks it unread on Home within a few
      seconds.
- [ ] Reattaching clears the unread state.
- [ ] A detached terminal session that prints nothing stays read — no unread churn from an idle
      TUI parked at a prompt.
- [ ] A terminal session that is actively printing shows as working, and stops when it goes quiet.
- [ ] Chat sessions behave exactly as before.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

Rebuild the agent image so the pod carries the change (`mise run cluster:build-agent`), then:

1. Open a terminal session on an agent and run something long and chatty:
   `for i in $(seq 1 90); do echo "line $i"; sleep 1; done`.
2. Close the terminal panel and go to Home. The session appears unread while it keeps printing,
   and shows as working.
3. Reopen it — unread clears.
4. Open a second terminal session, run nothing, close it. It must stay read, which is the check
   that matters: an idle TUI must not manufacture unread items.

If step 4 fails — a harness that redraws while idle — say so rather than widening the debounce to
hide it. That is the one outcome that would justify dropping this sub-issue, and the ADR should
then record the reason.
