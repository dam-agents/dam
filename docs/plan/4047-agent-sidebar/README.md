# Global sidebar with agents and activity

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4047

## Goal

From anywhere in the app, a user reaches any of their agents and their recent sessions across all agents in one click.
The left rail becomes a sidebar with an **Agents** section and an **Activity** section, as in the designer's comment on the issue.
Inside an agent, that agent's sessions drop down under its row, so the per-agent Sessions list leaves the chat view.
The top-right activity button becomes a bell that lists only what waits on the user: approvals.

The designer's comment and its screenshots on #4047 are the source of truth.
The branch `design/sidebar-agent-list` is a prototype on mock data and an old base: read it for intent, never copy it.

## Approach

UI only (`packages/ui`); every server procedure already exists.

- **Shell.** `IconRail` (`packages/ui/src/components/icon-rail.tsx`) already collapses and expands, persisted as `sidebarExpanded` in `modules/platform/store/sidebar.ts`.
  The new sidebar grows from it: expanded, it shows nav, Agents, Activity, Documentation and Settings; collapsed, it is the icon rail, and the Agents and Activity icons open flyouts.
  It is mounted twice in `app.tsx` (`MainApp`): beside `ChatView` and in the main layout.
- **Agents.** `useAgents` (`modules/agents/api/queries.ts`); `AgentView.state` is `AgentState`.
  Active agents are every state but `hibernating` and `hibernated`; those fold under "See all (N hibernating)".
  Agent actions come from `use-sandbox-row-actions.tsx`, the hook behind the Home agent row menu.
- **Per-agent sessions.** `useSessionPages(agentId, sessionFilter)` (`modules/sessions/api/queries.ts`), rows like `SessionRow`, unread from `isUnreadSession` (`modules/home/lib/unread.ts`).
- **Activity.** `trpc.attention.listForOwner` is the cross-agent session list (at most 200 items; `AttentionItem` has no agent name, so join with `useAgents`).
  `useFeed` / `useAttention` (`modules/home/api/queries.ts`) and the filter in `modules/home/lib/activity-filter.ts` already serve the top-right panel.
  The `working` flag is the value when the record was written; the top-right panel has the same limit today.
- **Architecture:** [home-feed](../../architecture/home-feed.md) (attention record, seen and unread), [sessions](../../architecture/sessions.md).

## Sub-issues

| #   | Title                         | Scope                                                                                                  | Depends on |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------ | ---------- |
| 01  | Sidebar with agents           | Expanded sidebar with nav, Agents (active, hibernating folded), Docs, Settings; collapsed rail flyout     | —          |
| 02  | Agent sessions in the sidebar | The open agent expands to its sessions with new-session, filter and ⋮; chat view loses its Sessions list | 01         |
| 03  | Activity in the sidebar       | Cross-agent sessions, newest first, 20 + 20, existing filter; collapsed rail flyout                       | 01         |
| 04  | Approvals bell                | Top-right button becomes a bell listing approvals only                                                   | 03         |
| 05  | Mobile navigation             | If time allows: design with `/frontend-design`, then build                                               | 01, 02, 03 |

## Conventions & glossary

- **Sidebar**: the global left column (expanded) or icon rail (collapsed).
- **Agent column**: what stays of today's chat sidebar, Files and Artifacts, under the agent's name.
- **Active agent**: any `AgentState` but `hibernating` and `hibernated`.
- Apply `/react-ui-engineering` to every slice. Carbon icons (`@carbon/icons-react`). No hardcoded brand: use `getBrand()`.

## Decisions

- Clicking an agent opens its chat and expands its sessions; only the agent whose chat is open is expanded.
- The agent row's ⋮ menu is the Home agent row's menu.
- Activity lists sessions only, newest first, 20 at a time; its filter is the existing channel and state filter without the "Approvals" state.
- Per-agent sessions: 5 at a time, newest first, with the existing session filter as an icon beside the new-session icon.
- "See all (N hibernating)" unfolds the hibernating agents inline.
- Mobile keeps today's bottom bar until slice 05.

## Action items

- [ ] Raise with the team: do scheduled and Slack-started sessions belong in Activity? This plan includes them, matching the screenshots.
- [ ] Confirm "all active agents, plus See all (N hibernating)" with the designer.

## Whole-feature smoke test

On the local cluster, with at least three agents, one hibernated, sessions on two of them (one from a schedule or Slack if available):

1. Home: the sidebar lists the active agents and "See all (1 hibernating)"; Activity lists sessions of every agent, newest first.
2. Click an agent: its chat opens and its sessions drop down under the row; click another: the first collapses.
3. Click an Activity row on another agent: that session opens and that agent expands.
4. Collapse the sidebar: the rail shows icons; the Agents and Activity icons open flyouts with the same lists. Reload: the state persists.
5. The top-right bell lists only pending approvals, and its badge counts them.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for #4047.
