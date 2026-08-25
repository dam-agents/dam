# 04 — Session Watch

**Depends on:** 03-sessions-list-on-pod-router
**Part of:** live updates for pod-sourced state — see [README](./README.md)

## Context

With the read on the pod router, this slice adds the Watch behind it and deletes the 5s poll. The pod already witnesses every event that changes the list — it intercepts `session/new`, `platform/deleteSession` and the resume-carried mode write, it stamps `seenAt` on engage and on prompt boundaries, and its prompt scheduler knows exactly when a turn starts and ends.

The one thing it does *not* witness as an edge is a terminal session going quiet. `isPtySessionActive` is true only when the PTY produced output within `PTY_ACTIVE_WINDOW_MS`, so nothing writes the falling edge — it simply becomes false as time passes. ADR-084 settles this: notices stay bare, and the pod carries a timer to spot the transition. That is a deliberate trade against a design that would have shipped a decaying value on the wire.

## Implementation plan

Apply `/typescript-engineering` for the pod and contract, `/react-ui-engineering` for the UI.

1. **Contract** — add a `watch` subscription to the `sessions` router from 03, yielding a bare notice. Every frame means "re-read the list"; a frame carries no session state. The first frame on every subscribe is the `sync` notice.
2. **Emit on the edges the pod already sees**, in `packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts`:
   - `session/new` response persisted;
   - `platform/deleteSession` tombstoned;
   - `session/resume` carrying a mode change;
   - `recordSeen` / `recordActivity` on engage and on prompt send and prompt response;
   - turn start and turn end from the prompt scheduler (`activeTurns` set and cleared).
   Emit from the places that already write, so a future writer that forgets is the only failure mode rather than a whole missing category.
3. **Terminal liveness timer** — while any PTY slot is active, run a timer that re-evaluates `isPtySessionActive` per session and emits when one flips false. Run it only while at least one PTY exists, so an agent with no terminal has no timer.
4. **Widen `PTY_ACTIVE_WINDOW_MS` from 1s to 5s** (`packages/agent-runtime/src/server.ts`). Confirmed safe: it has exactly one consumer, the `running` flag on the session list. The hibernation probe uses `ptySlots.size === 0`, not this window. At 1s a shell printing a line every 2s flips the dot true/false continuously; at 5s it stays lit and the emit rate drops accordingly.
5. **Coalesce** — a trailing debounce of ~250ms per subscription, so a burst of writes produces one notice. A single `git checkout` or a rapid sequence of turn boundaries must not fan out.
6. **The Watch exists only while subscribed.** No subscriber ⇒ no timer, no emits, nothing. This is the issue's central requirement, so make the lifetime explicit and covered by the acceptance criteria rather than incidental.
7. **UI** — in `packages/ui/src/modules/sessions/api/queries.ts`, delete `refetchInterval: STATUS_POLL_MS` and the constant, and subscribe to `sessions.watch` instead, invalidating the sessions query on each notice. Put the subscription in one place — the sidebar's owner, not per row — since `useAcpSessions` has several consumers (`sessions-sidebar.tsx`, `use-docked-experiment.ts`, `use-agent-greeting.ts`) and they must share one subscription.
8. Keep the existing optimistic cache mutators (`setSessionRunning`, `setSessionSeen`, `optimisticInsertSession`, `removeSessionFromCache`) — they make the local session feel instant, and a notice arriving afterwards is a harmless re-read.
9. Run `mise run ui:fix` and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run check`, `mise run test` and `mise run ui:fix` are clean.
- [ ] No `refetchInterval` remains on the sessions query, and `STATUS_POLL_MS` is gone.
- [ ] Starting a turn in one session shows working dots in another browser tab within ~1s.
- [ ] A terminal session's dot lights while output flows and clears within ~5s of it stopping.
- [ ] A schedule firing makes its session appear without any user interaction.
- [ ] With a subscriber attached and nothing happening, the pod emits nothing — no periodic notice traffic.
- [ ] With no subscriber, the pod runs no liveness timer.
- [ ] Killing the WebSocket and letting it reconnect refills the list from the `sync` notice.
- [ ] A burst — deleting several sessions quickly — produces a coalesced notice, not one per delete.

## Smoke test

`mise run check && mise run test`, then against a cluster with two browser tabs on the same agent:

1. Send a prompt in tab A. Tab B's sidebar shows working dots for that session within about a second, and clears when the turn ends.
2. Open a terminal session and run `while true; do date; sleep 2; done`. The dot stays lit rather than flickering — this is the widened window. Ctrl-C it; the dot clears within ~5s.
3. Attach a schedule firing within the minute and leave the sidebar visible. Its session appears on its own.
4. Idle check: with the chat view open and nothing running, watch the WS frames in DevTools for 60s. There should be tRPC keepalive `PING`/`PONG` and nothing else — no notices, no refetches.
5. Unwatched check: close every tab on that agent, then confirm from the pod logs that no liveness timer is running.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
