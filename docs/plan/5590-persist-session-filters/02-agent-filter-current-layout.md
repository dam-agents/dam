# 02 — A session filter for each agent, in the current layout

**Depends on:** 01-persist-global-filter
**Part of:** Persist session filters — see [README](./README.md)

## Context

In the current layout the per-agent lists in the **Agents** section have no filter, so a proactive agent's scheduled runs cannot be hidden there. This slice adds the **agent filter**: a per-agent `ActivityFilters` saved in `localStorage`, a filter control on every agent row, and that agent's list following it. The Activity section keeps the global filter only.

## Implementation plan

Apply **/react-ui-engineering**.

1. **Store** — new `packages/ui/src/modules/sessions/lib/agent-session-filters.ts`, modelled on `modules/sessions/lib/pinned-sessions.ts`:
   - Key `platform-agent-session-filters`; value a JSON object `agentId → serializeActivityFilters(...)`.
   - `readAgentSessionFilters(store = browserStorage): ReadonlyMap<string, ActivityFilters>` with the raw-string cache, parsing each entry with `parseActivityFilters` and skipping non-object entries.
   - `setAgentSessionFilter(agentId, filters, store = browserStorage)`: write the entry, or delete it when `!isFiltered(filters)`; notify in-tab listeners. When the agent's previous filter was on and the new one is off, call `keepFirstSessionPages()` (same rule as the global setter; it trims every agent, which is acceptable).
   - `useAgentSessionFilter(agentId): ActivityFilters | undefined` via `useSyncExternalStore` (`undefined` = none set), with the `storage` event for other tabs.
   - UNIT_BOUNDARY_DESCRIPTION comment in the style of `usePinnedSessions`: browser-only, per agent, removed when reset.
2. **Menu** — `modules/home/components/activity-filter-menu.tsx`: add optional props `label?: string` (default stays "Filter sessions") and `testId?: string` (default stays `sidebar-session-filter`), used for the tooltip, `aria-label` and `data-testid`. Keep the "(filtered)" suffix logic.
3. **Row control** — `modules/agents/components/sidebar-agent-actions.tsx`: add the agent filter as one more hover action (before New session), rendering `ActivityFilterMenu` with `label={`Filter sessions of ${agentName}`}` and `testId="sidebar-agent-session-filter"`. The click must not toggle the row (the kebab already uses `stopPropagation`; do the same on the trigger). While the agent's filter is on, keep this control visible without hover so the dot is always seen.
   - `modules/agents/components/sidebar-agent-row.tsx`: `actionCount` becomes `3 | 4` with matching `ACTIONS_PADDING` (each icon is ~26px: 3 → `86px`, 4 → `112px`); add a way to keep the actions padding "shown" while the filter is on. `sidebar-agents.tsx` passes `hasChannelActions(available) ? 4 : 3`, the agent name and the filter state.
4. **List** — `modules/sessions/components/sidebar-agent-sessions.tsx`:
   - `SidebarAgentSessions` reads `useAgentSessionFilter(agentId)`.
   - `SessionPreview` (attention-record rows): filter `sessions` with `matchesActivityFilters` (`modules/home/lib/activity-sessions.ts`) before `sidebarSessionWindow`.
   - `AgentSessionList` (own list): filter `rows` with `matchesActivityFilters({ session, working, unread, needsApproval }, filter)` before `sidebarSessionWindow`, as `sidebar-v2/agent-session-list.tsx` does. Paging stays click-driven (View more), so a narrow filter never loads every page by itself.
   - Empty text: "No sessions match the filter." when a filter is on and nothing is left, else "No sessions yet." (both `ListNote` sites).
5. **Activity unchanged** — `sidebar-activity.tsx` keeps the global filter only.
6. `docs/architecture/home-feed.md` — the Agents paragraph of the current layout: each agent row has a filter (status, type) kept in the browser per agent; it narrows that agent's list only, not Activity. Add Filter to the row's hover actions sentence.

## Acceptance criteria

- [ ] Every agent row in the Agents section has a filter control (on hover/focus; always shown while that agent's filter is on, with the dot).
- [ ] Unchecking Schedule on one agent hides its scheduled sessions in its list, both before and after View more; other agents and the Activity section are unaffected.
- [ ] The agent filter survives a reload and follows a change made in another tab.
- [ ] Reset to default on the agent filter removes its entry from `platform-agent-session-filters`.
- [ ] Opening the menu does not open/close the agent row; keyboard: Tab reaches the control, Enter opens it, Escape closes it.
- [ ] The global Activity filter behaves as after 01.
- [ ] `mise run check` and `mise run test` green in `packages/ui`.

## Smoke test

`cd packages/ui && mise run check && mise run test` (existing suites incl. `sidebar-agent-sessions.test.ts`, `pinned-sessions.test.ts`, `activity-filter-menu.test.ts`). Then, new layout off, on a local cluster with a scheduled agent: hover its row, open the filter, uncheck Schedule; its list drops scheduled sessions, View more still pages; Activity still lists them; reload and confirm; change it from a second tab and watch the first tab follow.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
