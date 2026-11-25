# 05 — Back to All agents keeps your place

**Depends on:** 04-pinned-section
**Part of:** Left nav: one list of sessions — see [README](./README.md)

## Context

Jamie's note on flow 5d: when the user goes back to All agents, the list scrolls to the session they had open, so they keep track of where they were. Decision 9: only when that row is already loaded; never fetch for it.

## Implementation plan

Apply `/react-ui-engineering`. Paths under `packages/ui/src/modules/`.

1. In `agents/components/sidebar-agents.tsx`, "← All agents" records a one-shot request (`scrollToOpenSession` in the sidebar store, or a callback through `SidebarSessions`) before `setSidebarAgent(null)`.
2. In `SidebarSessions` (and `sidebar-pinned.tsx`), after the all-agents rows render, if the request is set: find `[data-session-id="<open id>"]` within the scroll container `sidebar-sections` (Pinned first, then Sessions); if present, `scrollIntoView({ block: "nearest" })`; clear the request either way. Focus stays on the Agents section (the button that was clicked is gone; move focus to the selected Agent's row, as the Agents section heading's first focusable).
3. No session open, or the row not rendered → leave the scroll at the top.
4. `docs/architecture/home-feed.md`: one sentence on the behaviour.

## Acceptance criteria

- [ ] Open a session in an agent view, go back: the row is in view and marked open, in Pinned or Sessions.
- [ ] The open session older than the loaded rows: back stays at the top and loads nothing (no extra `listForOwnerPage` request in the network panel).
- [ ] Back from the new-chat page stays at the top.
- [ ] Keyboard focus lands on a visible control, not on `body`.
- [ ] `mise run test`, `mise run check`, `check:format`, `check:lint` pass.

## Smoke test

On the cluster with enough sessions to scroll: open an older visible session in an agent view, go back, see it scrolled into view; repeat with a session beyond the loaded rows and see no scroll and no request. Print the steps for the user.
