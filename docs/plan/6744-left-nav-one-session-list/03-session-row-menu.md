# 03 — ⋯ menu on every session row

**Depends on:** 02-agent-view-one-sessions-list
**Part of:** Left nav: one list of sessions — see [README](./README.md)

## Context

With nested lists gone (02), all-agents rows are the main place sessions appear, but only agent-view rows have a ⋯ menu. This slice gives every row the same menu — Rename, Export telemetry (when telemetry is on), Delete — so 04 can add Pin to one place (README decision 4).

## Implementation plan

Apply `/react-ui-engineering`. Paths under `packages/ui/src/modules/`.

1. Extract the row menu and its actions from `sessions/components/sidebar-agent-sessions.tsx` (`SessionActions`, `useActWhenAwake`, `useConfirmDeleteSession`, `RenameSessionDialog`, `downloadTelemetryExport`, the `SidebarSessionActions` it renders from `agents/components/sidebar-agent-actions.tsx`) into one hook, `sessions/hooks/use-session-row-actions.ts`, keyed by `agentId`, and one component the row renders.
2. `home/components/sidebar-activity-row.tsx` (move it to `sessions/components/` with 02's rename if not done): render the menu on hover/focus as the agent-view row does, with the row's `agentId`. Actions on a sleeping Agent wake it and run once it answers, as provisional rows do today (Delete asks its confirmation first).
3. One `RenameSessionDialog` per Sessions section, not per row.
4. Update `docs/architecture/home-feed.md`: all-agents rows carry the same actions as an Agent's own rows.

## Acceptance criteria

- [ ] Every row in both views shows the same ⋯ menu; Export telemetry only when the install has telemetry.
- [ ] Rename and Delete from an all-agents row on a hibernated Agent wake it, then act; Delete confirms before the wake.
- [ ] The agent-view menu behaves as before.
- [ ] `mise run test`, `mise run check`, `check:format`, `check:lint` pass.

## Smoke test

On the cluster, in All agents: rename a session of an awake Agent (row title updates), delete a session of a hibernated Agent (confirm, Agent wakes, row disappears). Print the steps for the user.
