# 03 — The agent filter in the new layout

**Depends on:** 02-agent-filter-current-layout
**Part of:** Persist session filters — see [README](./README.md)

## Context

In the new layout one filter on the Agents header narrows every agent's list and the Pinned section; agents have no filter of their own. This slice puts the agent filter from 02 on every agent row of the tree: an agent's list uses its own filter when one is set, else the global one. Pinned rows keep the global filter.

## Implementation plan

Apply **/react-ui-engineering**.

1. **Effective filter** — `modules/platform/components/sidebar-v2/agent-session-list.tsx`, `useAgentTreeRows`: read `useAgentSessionFilter(agentId)` (02) and use `agentFilter ?? globalFilter` for `matchesActivityFilters`, and return it as `filters`, so `AgentSessionList`'s `isFiltered(filters)` paging guard (Load more instead of scroll paging, empty texts) follows the effective filter.
2. **Row control** — `modules/platform/components/sidebar-v2/sidebar-tree.tsx`, `AgentNode`: add `ActivityFilterMenu` (with the `label`/`testId` props from 02: "Filter sessions of <agent>", `sidebar-agent-session-filter`) in the hover actions group before New session. Value: the agent's own filter, or the default when none is set (so the menu shows what is stored, not the global value). `onChange` → `setAgentSessionFilter`.
   - The actions group uses `REVEAL` (hover/focus/open). While the agent's filter is on, keep the filter control visible without hover so the dot is seen; widen the row button's right padding (`pr-16`) so the name never runs under three icons.
   - The closed-row cue (`AgentCue`) stays as it is.
3. **Pinned** — `sidebar-tree.tsx` (`pinned` memo) and `pinned-rows.tsx` (`OffFeedPinnedRow`) keep `sidebarActivityFilters`. No change, but check nothing there picks up the agent filter.
4. `docs/architecture/home-feed.md`, **The new layout**: the Agents header filter narrows the Pinned section and every agent's list that has no filter of its own; each agent row carries its own filter, kept in the browser, which replaces the header filter for that agent's list; the paging rule follows the filter the list applies.

## Acceptance criteria

- [ ] Every agent row in the tree has a filter control on hover/focus, always visible with its dot while that agent's filter is on.
- [ ] An agent with its own filter shows sessions by that filter, whatever the header filter says; an agent without one follows the header filter; Pinned follows the header filter.
- [ ] Reset to default on an agent filter makes its list follow the header filter again.
- [ ] With an agent filter on, its list loads further pages only on Load more; with no filter in force it pages on scroll as before.
- [ ] The filter set on an agent in the current layout (02) is the same one shown here, and the reverse.
- [ ] `mise run check` and `mise run test` green in `packages/ui`.

## Smoke test

`cd packages/ui && mise run check && mise run test` (existing suites incl. `sidebar-session-paging.test.ts`, `sidebar-agent-sessions.test.ts`). Then, new layout on, on a local cluster with a scheduled agent and a second agent: header filter "Unread"; the scheduled agent's own filter with Schedule unchecked. Its list shows non-scheduled sessions of any status; the second agent shows only unread ones; Pinned shows only unread pins. Reset the agent filter and its list switches to unread only. Reload; everything is kept.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
