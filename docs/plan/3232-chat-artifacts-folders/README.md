# Artifacts panel folders

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3232
**Design:** https://www.figma.com/design/zNIYydUKN1QLZDYozpQJpn/DAM-DEV?node-id=2307-3210 — panel screenshots in [`design/`](./design/); the linked node is the `FileRow` component (215px title container, link icon, overflow menu)

## Goal

The chat sidebar's Artifacts panel shows the agent's artifacts grouped by folder, the way the
library page does: collapsible folder groups with counts, an "Ungrouped" group, and drag an
artifact onto a folder to file it without leaving the conversation. The sandbox home Artifacts
section gets the same grouping. Truncated titles get the design's marquee scroll.

Decisions recorded at planning:

- A folder in the panel shows **only this agent's artifacts**; counts are derived locally.
- **All user folders appear**, empty ones included — otherwise there is nothing to drag a fresh
  artifact into. Experiment folders appear only when the agent has artifacts in them, and are
  not drop targets when empty.
- Sandbox home grouping is **in scope** as the final slice.

## Approach

Entirely client-side — the contract already provides everything. Read
[`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md) (UI surfaces
section) first. Key facts:

- `artifactLibrary.list({ agentId })` already returns `folderId` per artifact
  (`packages/api-server-api/src/modules/artifact-library/types.ts` ~37); grouping is a
  client-side `Map` keyed on it, exactly as `views/artifacts-view.tsx` (~73–80) does.
- `artifactLibrary.listFolders` is owner-wide and its `artifactCount` counts the whole owner —
  **never show that count in the panel**; count the agent-filtered rows instead.
- Moving = `useUpdateArtifact()` with `folderId` (`modules/artifacts/api/mutations.ts` ~31–74) —
  shipped by #3231, optimistic across every `list` query variant including the agent-scoped one.
- Drag and drop is hand-rolled native HTML5 in
  `modules/artifacts/hooks/use-artifact-row-drag.ts` (`useArtifactRowDrag`,
  `useFolderDropTarget`, custom MIME) — reused, not reinvented. The drag *orchestration*
  (hot folder, drag origin, drop→move) lives inline in `artifacts-view.tsx` (~57–110) and gets
  extracted first (sub-issue 01) so the panel becomes its second consumer.
- Live updates need no work: the owner-wide live-events subscription invalidates
  `artifactLibrary` queries on artifact and folder changes.
- The chat panel (`modules/artifacts/components/chat-artifacts-panel.tsx`) has its own compact
  row (`ArtifactListRow`, ~113–175) — it stays the row primitive and gains folder groups around
  it. The sandbox home section (`components/sandbox-artifacts-section.tsx`) uses the library's
  `ArtifactRow`.

All paths under `packages/ui/src/modules/artifacts/` unless noted.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | [Extract folder-drag orchestration](./01-extract-drag-orchestration.md) | Refactor: lift the library view's drag state into a reusable hook; behavior unchanged | — |
| 02 | [Folder groups in the chat panel](./02-panel-folder-groups.md) | Group panel rows by folder; all user folders; collapse with per-agent persisted state; counts | — |
| 03 | [Drag-to-folder in the panel](./03-panel-drag-to-folder.md) | Rows draggable, folder headers drop targets, drop moves the artifact | 01, 02 |
| 04 | [Marquee title truncation](./04-marquee-titles.md) | Looping title scroll on overflow per the design spec, reduced-motion safe | 02 |
| 05 | [Sandbox home grouped by folder](./05-sandbox-home-groups.md) | Same grouping on the agent page's Artifacts section | 02 |

## Conventions & glossary

- Apply **/react-ui-engineering** on every slice (all UI).
- "User folder" vs "experiment folder": split by name prefix via `lib/folders.ts`
  (`isUserFolder` / `isExperimentFolder`).
- Collapse-state persistence follows the files panel precedent: per-agent map in the zustand
  store (`modules/files/store.ts` `expandedDirs`, ~67–93); the artifacts slice lives in
  `modules/artifacts/store.ts`.
- Row layout per the `FileRow` design node: title (marquee container), link icon (map to the
  existing share affordance), overflow menu — the current kind badge goes away in the panel.
- After UI edits run `mise run ui:fix`; verify with `mise run ui:check`, `mise run ui:test`,
  `mise run common:check:comment-types`.
- Grep `packages/e2e/playwright/` before renaming any `data-testid` on panel rows.

## Whole-feature smoke test

On the Vite dev server (`localhost:5173`) with an agent that has artifacts in ≥2 folders plus
ungrouped ones, and at least one empty user folder:

1. Chat sidebar → Artifacts: groups render with counts per [`design/DAM.png`](./design/DAM.png);
   collapse/expand per [`DAM-1.png`](./design/DAM-1.png); state survives switching agents and back.
2. Drag an ungrouped artifact onto a folder header ([`DAM-2.png`](./design/DAM-2.png)) — it
   files there optimistically; drag into the empty folder works; library page reflects it.
3. A long title scrolls per the marquee spec; short titles don't; with reduced motion enabled,
   nothing animates.
4. Sandbox home → Artifacts section shows the same grouping.
5. Library page drag/drop still behaves exactly as before (post-01 regression check).

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3232. This plan folder is deleted before the PR leaves
draft (`Plan check` CI blocks merge while it exists).
