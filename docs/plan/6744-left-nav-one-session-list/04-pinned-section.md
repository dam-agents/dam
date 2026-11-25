# 04 — Pinned section

**Depends on:** 01-session-pins-server, 03-session-row-menu
**Part of:** Left nav: one list of sessions — see [README](./README.md)

## Context

The UI half of #6745: Pin/Unpin in the row menu and a Pinned section above Sessions (README decisions 4–8). Reads and writes `sessionPins` from 01.

## Implementation plan

Apply `/react-ui-engineering`. Paths under `packages/ui/src/modules/`.

1. **Queries** — `sessions/api/session-pins.ts`: `useSessionPins()` (`trpc.sessionPins.list`), `usePinSession()` / `useUnpinSession()` with optimistic update of the list cache and rollback on error; invalidate on success. A `isPinned(agentId, sessionId)` selector from a `Set` of keys.
2. **Menu** — add _Pin session_ / _Unpin session_ first in the menu from 03 (`sessions/hooks/use-session-row-actions.ts`). Pinning needs no wake: it does not touch the Agent.
3. **Pinned section** — `sessions/components/sidebar-pinned.tsx`, rendered by `SidebarSessions` above its list, hidden while it has no rows, sticky header like Sessions, no filter control, no View more:
   - All agents: every pin whose `item` is non-null, rendered with the same row component as Sessions (agent name, time, unread/approval dot, menu, open/selected mark), ordered as the list returns (newest activity first).
   - Agent view: that Agent's pins. For an owned Agent use `item`; for a Shared Agent (`item === null`) take the row from the Agent's own list (`AgentSessionList` data) when loaded — until then the pin is not shown (never a placeholder). Re-sort by the same activity time as Sessions.
   - The open session in Pinned carries the same open mark as in Sessions.
4. **No repeats** — `SidebarSessions` drops pinned keys from both data sources before windowing, so View more counts and focus moves stay right (`sidebarSessionWindow`, `viewMore` in `sidebar-agent-sessions.tsx` operate on the filtered rows). Filters apply only to Sessions, never to Pinned.
5. **Collapsed rail** — the Sessions flyout shows Pinned too (it renders `SidebarSessions`).
6. **Docs** — `docs/architecture/home-feed.md`: the Pinned section, its order, its independence from filters, Shared Agent pins only in the agent view.

## Acceptance criteria

- [ ] Pin from ⋯: the session moves to Pinned at once (optimistic) and leaves Sessions, in both views; Unpin returns it to its recency place in Sessions.
- [ ] A filter on Sessions never hides a pinned row.
- [ ] Pinned rows look and act exactly like Sessions rows (dots, time, menu, open mark).
- [ ] A pin on a Shared Agent shows only in that Agent's view, once its list loads.
- [ ] Pins survive reload and show in another browser.
- [ ] Pinned is absent when there are no pins to show in the current view.
- [ ] `mise run test`, `mise run check`, `check:format`, `check:lint` pass.

## Smoke test

On the cluster: README smoke steps 3–6 in agent-browser. Print them for the user.
