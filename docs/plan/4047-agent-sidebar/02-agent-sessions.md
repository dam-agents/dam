# 02 — Agent sessions in the sidebar

**Depends on:** 01-sidebar-with-agents
**Part of:** Global sidebar with agents and activity — see [README](./README.md)

## Context

The open agent's sessions drop down under its row in the sidebar (screenshot 5 on the issue), so the chat view's own Sessions list goes away.
Files and Artifacts stay, as their own column under the agent's name.

## Implementation plan

Apply `/react-ui-engineering`.

1. Under the selected agent's row, render its sessions from `useSessionPages(agentId, sessionFilter)` (`modules/sessions/api/queries.ts`), newest first: 5, then "View more" adds 10.
   Reuse `SessionRow` (`modules/sessions/components/session-row.tsx`) or its parts: title, relative time, Slack icon, working dots, unread dot, approval badge.
   Keep `useProvisionalSessions` so rows show before the list loads.
2. Only the agent whose chat is open is expanded; opening another agent collapses the first.
3. Row hover and selected state show, right-aligned: a new-session icon (the action today's Sessions "+ New" runs), a filter icon that opens the existing session filter (today's funnel in `sessions-sidebar.tsx`), and a ⋮ menu with the Home agent row's actions from `modules/agents/hooks/use-sandbox-row-actions.tsx`.
4. Clicking a session opens it; the open session's row is selected.
5. In `modules/sessions/views/chat-view.tsx`, remove the `SessionsSidebar` section; the column keeps Files and Artifacts (resized by `useSidebarPanels`) under a header with the agent's avatar and name.
   Delete what only the old Sessions section used; move what the sidebar still needs.

## Acceptance criteria

- [ ] The open agent shows its sessions, 5 first and then 10 more per "View more", newest first, with unread, working, Slack and approval markers.
- [ ] New session, the session filter and the ⋮ menu work from the agent row.
- [ ] Opening another agent collapses the previous one.
- [ ] The chat view has no Sessions section; Files and Artifacts work as before.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

Open an agent with seven sessions: five show, "View more" shows seven; start a new session from the row icon; filter to Slack; open the ⋮ menu and Configure; open another agent and see the first collapse; the chat column shows only Files and Artifacts.
