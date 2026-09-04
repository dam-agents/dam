# 02 — Folder groups in the chat panel

**Part of:** Artifacts panel folders — see [README](./README.md)

## Context

The chat sidebar's Artifacts panel renders one flat `artifacts.map` — the organization a user
built in the library is invisible in chat. This slice makes the panel render collapsible folder
groups per the design ([`design/DAM.png`](./design/DAM.png), [`DAM-1.png`](./design/DAM-1.png)):
every user folder (empty included), each showing only this agent's artifacts, plus an
"Ungrouped" group.

## Implementation plan

Apply the /react-ui-engineering skill. All paths under `packages/ui/src/modules/artifacts/`.

1. **Data** — in `components/chat-artifacts-panel.tsx` (flat map at ~66–83), additionally call
   `useArtifactFolders()` when the section is open (`api/queries.ts` — mirror the `skipToken`
   gating the artifacts query uses at ~12–21). Group the agent's artifacts by `folderId` the way
   `views/artifacts-view.tsx` ~73–80 does; render user folders (via `lib/folders.ts`
   `isUserFolder`) sorted as the library sorts them, then Ungrouped. Include experiment folders
   only when the agent has artifacts in them. Counts come from the grouped rows — never from
   `folder.artifactCount` (owner-wide).
2. **Group component** — a compact sidebar folder group (new component in `components/`):
   `DisclosureToggle` header with chevron, folder icon, name, and a right-aligned
   "N artifacts" count per the design. The library's `FolderGroup` is card-shaped and not
   reusable at sidebar density — reuse only `DisclosureToggle` and the grouping idiom.
3. **Row layout** — keep `ArtifactListRow` (same file, ~113–175) as the row, restyled per the
   `FileRow` design node: title, link icon mapped to the existing share affordance, overflow
   menu (`ArtifactRowMenuItems` stays); the kind badge goes away. Rows indent under their group.
4. **Collapse state** — persisted per agent in the artifacts store slice
   (`modules/artifacts/store.ts`), following the files panel's `expandedDirs` shape
   (`modules/files/store.ts` ~67–93). Default: expanded; empty folders default collapsed.
5. Preserve the existing behaviors: row click toggles the docked preview, live-event
   invalidation keeps the list fresh (no extra wiring), the panel still fetches nothing while
   collapsed.
6. Grep `packages/e2e/playwright/` for the panel's test ids before renaming; give group headers
   a `data-testid` (e.g. `artifacts-folder-<id>`).

## Acceptance criteria

- [ ] Panel shows user folders (empty included, collapsed by default) with agent-scoped
      contents and locally derived counts; Ungrouped listed last; experiment folders only when
      non-empty for this agent.
- [ ] Collapse state survives switching agents and back within the session.
- [ ] Rows match the design layout (title / share affordance / menu; no kind badge) and all
      existing row actions still work.
- [ ] No server changes; `folder.artifactCount` unused by the panel.
- [ ] `mise run ui:check`, `mise run ui:test`, `mise run common:check:comment-types` pass.

## Smoke test

`mise run ui:test` and `mise run ui:check`. Manually on the Vite dev server, with an agent
holding artifacts in two folders plus ungrouped ones and one empty folder: open the chat
sidebar's Artifacts section and compare against [`design/DAM.png`](./design/DAM.png) /
[`DAM-1.png`](./design/DAM-1.png); collapse a folder, switch agent, switch back — state kept;
publish a new artifact from the agent and see it appear under Ungrouped. Print those steps as
the manual guide for the user.
