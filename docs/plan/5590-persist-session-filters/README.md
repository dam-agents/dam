# Persist session filters, globally and per agent

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/5590

## Goal

A user with a proactive agent sees a sidebar crowded with that agent's scheduled runs. Today the session filter resets on every reload and is one filter for every agent, so the user sets it again and again and cannot hide one agent's schedules without hiding everyone's.

After this feature:

- The **global session filter** (status and types) survives a reload, a new tab and a new login in the same browser.
- Every **agent row** in both layouts carries its own **agent filter** (status and types), also saved in the browser, so "always hide Schedule for my proactive agent" is one setting that sticks.
- A filter applies only where the user can see and change it: there is never a filter in force that has no control on screen.

## Approach

UI-only, in `packages/ui`. No api-server, agent-runtime or database change. Architecture context: [`docs/architecture/home-feed.md`](../../architecture/home-feed.md) (the sidebar, the Activity section, **The new layout**) and [`docs/architecture/features.md`](../../architecture/features.md) (the `new-layout` experimental feature).

**Where filters live today** (verified on `main`, 2026-10-21):

- One filter model, `ActivityFilters { channelTypes: Set<ChannelType>; state: StateFilter }`, in `packages/ui/src/modules/home/lib/activity-filter.ts`, edited by the one menu `ActivityFilterMenu` (`modules/home/components/activity-filter-menu.tsx`).
- One global value, `sidebarActivityFilters`, in the zustand sidebar slice `modules/platform/store/sidebar.ts`. In memory only.
- **Current layout** (`Sidebar`): the menu sits on the **Activity** section header (`modules/home/components/sidebar-activity.tsx`) and narrows only that cross-agent feed. The per-agent lists in the **Agents** section (`modules/agents/components/sidebar-agents.tsx` → `modules/sessions/components/sidebar-agent-sessions.tsx`) have no filter.
- **New layout** (`SidebarV2`, flag `new-layout`): the menu sits on the tree's **Agents** header (`modules/platform/components/sidebar-v2/sidebar-tree.tsx`) and narrows the Pinned section (`sidebar-tree.tsx`, `pinned-rows.tsx`) and every agent's list (`sidebar-v2/agent-session-list.tsx`).
- The unrelated `sessionFilter: SessionCategory[]` in `modules/sessions/store/sessions.ts` (server-side categories, no UI, always all) is **out of scope**; leave it alone.

**Target model:**

| Surface                                    | Filter applied                                       |
| ------------------------------------------ | ---------------------------------------------------- |
| Current layout → Activity section          | global filter                                        |
| Current layout → an agent's list in Agents | that agent's filter (none set → unfiltered)          |
| New layout → Pinned section                | global filter                                        |
| New layout → an agent's list in the tree   | that agent's filter when set, else the global filter |

**Storage** — both in `localStorage`, decided with the operator (one place, browser-local, like pinned sessions; no server sync):

- Global: key `platform-session-filter`, one JSON object `{ "types": ChannelType[], "state": StateFilter }`.
- Per agent: key `platform-agent-session-filters`, one JSON object `{ [agentId]: { "types": ChannelType[], "state": StateFilter } }`. An agent whose filter equals the default (`!isFiltered`) is **removed** from the map, so "Reset to default" leaves no entry and the new layout falls back to the global filter.
- Reading is tolerant: unknown types are dropped, an unknown state becomes `"any"`, malformed JSON gives the default. Writes go through `safeSetItem` (`lib/safe-storage.ts`).
- The per-agent store follows the `pinned-sessions.ts` pattern: a module-level cache keyed by the raw string, `useSyncExternalStore`, in-tab listeners plus the `storage` event for other tabs.
- Entries of deleted agents may linger (as pins do); they show nowhere and cost nothing. No sweep.

**Serialization contract** (01 defines it, 02 reuses it), in `modules/home/lib/activity-filter.ts`:

```ts
export function serializeActivityFilters(filters: ActivityFilters): {
  types: ChannelType[];
  state: StateFilter;
};
export function parseActivityFilters(raw: unknown): ActivityFilters; // tolerant, defaults on anything malformed
```

**Paging with a filter.** A filter narrows only the pages already loaded (see #5510). Keep the existing guards: the new layout's agent list loads further pages on click (**Load more**) while its effective filter is on; the current layout's agent list pages only on **View more** clicks. When a filter is cleared, call `keepFirstSessionPages()` as the global setter already does.

## Sub-issues

| #   | Title                                                  | Scope                                                                                                                                              | Depends on |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01  | Keep the global session filter after a reload          | Serialize/parse helpers; the sidebar slice reads and writes `platform-session-filter`. Both layouts.                                               | —          |
| 02  | A session filter for each agent, in the current layout | Per-agent filter store in localStorage; a filter control on each agent row in the Agents section; that agent's list (preview and full) follows it. | 01         |
| 03  | The agent filter in the new layout                     | A filter control on each agent row in the tree; the agent's list uses its own filter, else the global one; Pinned stays global.                    | 02         |

## Conventions & glossary

- **Global filter** — the one `sidebarActivityFilters` value; its control is the header menu (Activity in the current layout, Agents in the new layout).
- **Agent filter** — the filter stored for one agent id; its control is on that agent's row. Same shape and same menu as the global filter.
- **Effective filter** — what a list actually applies (see the table above).
- Reuse `ActivityFilterMenu` for every control; do not fork it. Give it a way to set an accessible label naming the agent (e.g. "Filter sessions of <agent>") and a distinct `data-testid` (`sidebar-agent-session-filter`).
- Apply **/react-ui-engineering** to every slice (all work is in `packages/ui`). Domain helpers stay pure in `lib/`; hooks in `hooks/` or beside the store as `pinned-sessions.ts` does.
- Update [`docs/architecture/home-feed.md`](../../architecture/home-feed.md) in the slice that changes the behavior it describes (filter persistence, the agent filter control); `doc-drift` checks this.
- No new tests unless a slice says so. Existing unit suites touching this: `activity-filter-menu.test.ts`, `persisted-prefs.test.ts`, `pinned-sessions.test.ts`, `sidebar-agent-sessions.test.ts`, `sidebar-session-paging.test.ts` (all in `packages/ui/src/__tests__/unit/`).

## Whole-feature smoke test

On a local cluster with at least two agents, one of them with a schedule that has fired a few times (or `Run now` twice):

1. **Current layout** (new layout off). In Activity, set Status "Unread" and uncheck Terminal. Reload: both survive; the filter icon shows its dot.
2. On the scheduled agent's row in Agents, open its filter and uncheck Schedule. Its list hides scheduled sessions; the other agent's list is unchanged; Activity still shows the scheduled sessions (global filter only). Reload: the agent filter survives.
3. Open a second tab, change that agent's filter there; the first tab follows without a reload.
4. Turn the new layout on. The Agents header filter shows the saved global filter. The scheduled agent's list hides scheduled sessions (its own filter); the other agent's list follows the global filter. Pinned follows the global filter.
5. "Reset to default" on the scheduled agent's filter: its list now follows the global filter, and its row control loses its dot.
6. `mise run check` and `mise run test` in `packages/ui` are green.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/5590.
