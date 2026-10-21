# 01 — Keep the global session filter after a reload

**Part of:** Persist session filters — see [README](./README.md)

## Context

The global filter (`sidebarActivityFilters`) lives in memory and resets on every reload. This slice saves the whole filter, status and types, in `localStorage` and loads it when the store is created. Both layouts read the same slice value, so both get it at once. It also adds the serialization contract slice 02 reuses.

## Implementation plan

Apply **/react-ui-engineering**.

1. `packages/ui/src/modules/home/lib/activity-filter.ts` — add the pure contract from the README:
   - `serializeActivityFilters(filters)` → `{ types: [...channelTypes] in CHANNEL_TYPES order, state }`.
   - `parseActivityFilters(raw: unknown)` → `ActivityFilters`. Accept only an object with a `types` array and a `state` string; keep the types that are in `CHANNEL_TYPES`, map an unknown `state` to `"any"`, return `defaultActivityFilters()` for anything else. An empty `types` array is a valid, saved choice (the menu allows unchecking every type) — keep it.
2. `packages/ui/src/modules/platform/store/sidebar.ts`:
   - Add `SIDEBAR_SESSION_FILTER_STORAGE_KEY = "platform-session-filter"` beside the other keys.
   - Initial value: read the key with `safeGetItem(browserStorage, …)`, `JSON.parse` inside `try`, then `parseActivityFilters`. Put this in a small `readStoredSessionFilter()` like `readStoredSidebarExpanded()`.
   - `setSidebarActivityFilters`: keep the `keepFirstSessionPages()` behavior, then write `JSON.stringify(serializeActivityFilters(filters))` with `safeSetItem`; when `!isFiltered(filters)`, remove the key instead (`safeRemoveItem` in `lib/safe-storage.ts`), so the default leaves nothing stored.
3. No change in `sidebar-activity.tsx`, `sidebar-tree.tsx`, `agent-session-list.tsx` or `pinned-rows.tsx`: they already read the slice.
4. `docs/architecture/home-feed.md` — in the Activity paragraph and in **The new layout**'s filter sentence, say the filter is kept in the browser across reloads, like pins.

## Acceptance criteria

- [ ] Setting status and types in the current layout's Activity menu, then reloading, shows the same filter and the dot on the control.
- [ ] Same in the new layout's Agents header menu; switching layouts keeps the same global filter.
- [ ] "Reset to default" removes the stored key; a reload shows the default.
- [ ] A hand-edited bad value (`localStorage.setItem("platform-session-filter", "nope")`) loads as the default, without an error in the console.
- [ ] Clearing a filter still keeps only the first page of loaded session lists (`keepFirstSessionPages`).
- [ ] `mise run check` and `mise run test` green in `packages/ui`.

## Smoke test

`cd packages/ui && mise run check && mise run test` (existing suites: `activity-filter-menu.test.ts`, `persisted-prefs.test.ts`, `sidebar-session-paging.test.ts`). Then on the local UI: set Status "Needs attention" and uncheck Schedule, reload, confirm both kept; open DevTools → Application → Local Storage and see `platform-session-filter`; Reset to default and confirm the key is gone.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
