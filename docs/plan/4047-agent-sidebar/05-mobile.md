# 05 — Mobile navigation

**Depends on:** 01-sidebar-with-agents, 02-agent-sessions, 03-activity
**Part of:** Global sidebar with agents and activity — see [README](./README.md)

## Context

Required: slice 02 removes the chat view's Sessions list, which was the only way to switch sessions on a phone.
On mobile the rail is a bottom bar today, with no agents or activity, so until this slice lands a phone cannot reach an agent's sessions.

## Implementation plan

1. Design first with `/frontend-design:frontend-design`, shown to the user in an artifact for approval. Approved (artifact "#4047 · Mobile navigation", version 3): the drawer, with no bottom bar.
2. Build it with `/react-ui-engineering`, reusing the sections from 01–03:
   - Remove the mobile bottom bar.
   - Every page below `md` gets one top bar: Menu (opens the drawer), the page or agent name, the approvals bell.
   - The drawer holds the expanded sidebar's content unchanged: nav, Agents with the open agent's sessions, Activity, Documentation, Settings. Picking an agent keeps it open; opening a session or a destination closes it.
   - Chat on a phone opens on the chat itself. Menu replaces the back arrow; a files button opens the Files / Artifacts / Processes column as its own screen, with a back arrow to the chat. The Configure button hides below `md`; the agent's ⋮ menu has Configure.

## Acceptance criteria

- [ ] The user approved the design.
- [ ] At phone width, a user opens an agent and a recent session in two taps.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

In a 390px-wide browser window: open the navigation, open an agent, open a session from Activity.
