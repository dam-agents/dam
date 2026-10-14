# 03 — Activity in the sidebar

**Depends on:** 01-sidebar-with-agents
**Part of:** Global sidebar with agents and activity — see [README](./README.md)

## Context

The Activity section lists recent sessions across all agents, so a user switches between work on different agents without going back to Home.
It holds sessions only; approvals move to the bell (04).

## Implementation plan

Apply `/react-ui-engineering`.

1. Data: the session items of `useFeed` / `useAttention` (`modules/home/api/queries.ts`), from `trpc.attention.listForOwner`, newest first by `activityAt`. Join the agent name and avatar from `useAgents`. No server change.
2. Row (screenshot 2): title, then "agent · relative time", a Slack icon for Slack-started sessions, working dots while `working`, an unread dot from `isUnreadSession`. Click opens the session in its agent's chat, which also expands that agent (02).
3. 20 rows, then "View more" adds 20, inside the section's own scroll area.
4. Filter: the funnel opens the existing filter from `modules/home/lib/activity-filter.ts` and `activity-filter-bar.tsx`: channel types, and state All, In progress, Unread. Leave out the "Approvals" state here.
5. Collapsed rail: the Activity icon shows an unread dot and opens a popover with the same list and filter (screenshot 4).
6. Empty state: one line saying no sessions yet.

## Acceptance criteria

- [ ] Activity lists sessions of every agent, newest first, 20 at a time, with agent name, time, Slack, working and unread markers.
- [ ] The filter narrows by channel and state; no approvals appear.
- [ ] Clicking a row opens that session and expands its agent.
- [ ] Collapsed: the Activity icon has an unread dot and a flyout with the list.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

With sessions on two agents: Activity shows both, newest first; send a prompt on one and it moves to the top with working dots; filter to Unread; click a row on the other agent and its session opens with that agent expanded; collapse and open the Activity flyout.
