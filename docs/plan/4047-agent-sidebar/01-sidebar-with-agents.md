# 01 — Sidebar with agents

**Part of:** Global sidebar with agents and activity — see [README](./README.md)

## Context

The left rail becomes the global sidebar.
This slice builds its frame and the Agents section, so a user finds any agent from any page.
Activity (03) and per-agent sessions (02) plug into the sections this slice lays out.

## Implementation plan

Apply `/react-ui-engineering`.

1. Split `packages/ui/src/components/icon-rail.tsx` by responsibility before it grows: a shell (expanded column or collapsed rail, mobile bottom bar unchanged), a nav group (Home, Artifacts, Starter Kits), a footer (Documentation, Settings), and an `AgentsSection` in a new `modules/agents/components/sidebar-agents.tsx` (or a `modules/platform/components/sidebar/` folder; pick one home and keep it).
2. Expanded layout, top to bottom, per screenshot 2 on the issue: brand and collapse chevron; nav; **Agents** heading with a + button (opens the create-agent flow the Home "Create agent" button opens); one row per active agent (avatar, name, unread dot when any of its sessions is unread); "See all (N hibernating)"; the Activity slot (empty until 03); Documentation and Settings pinned at the bottom.
3. Agent row click: open that agent's chat (the same navigation the Home agent row uses). Mark the row of the open agent as selected.
4. "See all (N hibernating)" unfolds the `hibernating` and `hibernated` agents inline, dimmed, with "Show less". The fold is persisted in local storage, like the expanded state; hidden when N is 0. The agent whose chat is open is never folded: it shows among the active agents.
5. Collapsed rail (screenshot 1): icons for Home, Artifacts, Starter Kits, Agents, Activity; Documentation and Settings at the bottom. The Agents icon opens a click-triggered popover to the right with the same Agents section (screenshot 3). Keep the tooltip on hover.
6. Width: the expanded sidebar sets its own width (about 260px); keep the `sidebarExpanded` flag and its storage key.

## Acceptance criteria

- [ ] Expanded: nav, Agents with +, active agents, the hibernating fold, Documentation and Settings, on Home and in chat.
- [ ] Clicking an agent opens its chat; the open agent's row is selected.
- [ ] Hibernating and hibernated agents appear only after "See all (N hibernating)".
- [ ] Collapsed: the Agents icon opens a flyout with the same list; collapse state survives a reload.
- [ ] Mobile bottom bar unchanged.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

On the local cluster with three agents, one hibernated: Home shows the two active agents and "See all (1 hibernating)"; unfolding shows the third; clicking an agent opens its chat; collapsing shows the rail and the Agents flyout lists the same agents.
