# Move an existing artifact into a folder

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3231

## Goal

A user organizes the artifacts they already have, from the Artifacts library itself. Any
artifact can go into a folder, come out again, or move to a different folder. Today a folder can
only be chosen while uploading, so a folder made after the fact stays empty and the library
grows into one flat list. The only workaround is to ask an agent to move the artifact, which
needs a sandbox, a session and the right words.

## Approach

**The backend is already done. This feature is UI only.**

`artifactLibrary.update({ id, folderId })` moves an artifact:

- `folderId: "<id>"` files it into that folder.
- `folderId: null` takes it out (ungrouped).
- `folderId` absent leaves the folder untouched.

The contract already allows all three: `artifactUpdateInputSchema.folderId` is
`z.string().min(1).nullish()`
([`schemas.ts`](../../../packages/api-server-api/src/modules/artifact-library/schemas.ts)), and
the service applies it
([`packages/api-server/src/modules/artifact-library/`](../../../packages/api-server/src/modules/artifact-library/)).
The UI mutation hook `useUpdateArtifact` also exists already, and its `meta.invalidates`
refreshes both `list` and `listFolders`, so a moved row and both folder counts update with no
extra work
([`api/mutations.ts`](../../../packages/ui/src/modules/artifacts/api/mutations.ts)).

So **no contract change, no service change, no migration, no new tRPC procedure.** Every step in
both sub-issues lives under
[`packages/ui/src/modules/artifacts/`](../../../packages/ui/src/modules/artifacts/).

Architecture page: [artifact-library](../../architecture/artifact-library.md). Nothing on that
page changes — folders, the single-folder relation and the update path are all described there
already. The page's "UI surfaces" section lists folder management as part of the Artifacts
destination, which is what this feature completes.

### An artifact lives in exactly one folder

`LibraryArtifact.folderId` is `string | null`
([`types.ts`](../../../packages/api-server-api/src/modules/artifact-library/types.ts)). One
folder, or none. The issue asked whether an artifact could live in several; several would need a
join table and a migration, which is out of scope for a UI issue. Moving is therefore a
*reassignment*, not an add — the picker holds one value and "No folder" is a real choice, not a
clear button.

### Two paths to the same mutation

| Path | Where it works | Why |
|------|----------------|-----|
| **"Move to folder…"** in the row overflow menu | All three surfaces that render artifact rows | Keyboard and screen-reader reachable. Reaches the take-out case through a "No folder" option. This is the primary path. |
| **Drag a row onto a folder group** | The Artifacts library view only | An accelerator for cleaning up many artifacts. The chat sidebar and sandbox home show no folders on screen, so there is nothing to drop onto there. |

The three surfaces that render an artifact row and its overflow menu:

1. `views/artifacts-view.tsx` → `components/folder-group.tsx` → `components/artifact-row.tsx` —
   the library, grouped by folder.
2. `components/sandbox-artifacts-section.tsx` → `components/artifact-row.tsx` — the sandbox home
   Artifacts section.
3. `components/chat-artifacts-panel.tsx` → its own `ArtifactListRow` → `ArtifactRowMenuItems` —
   the session sidebar.

`components/experiments-section.tsx` re-uses `FolderGroup`, so it inherits whatever the row
gains.

### A dialog, not a submenu

Rename, Share and Retention are each a dialog, plumbed through the same three surfaces
(`RenameArtifactDialog`, `ShareDialog`, `RetentionDialog`). Move follows that pattern. A folder
submenu inside the overflow menu was the alternative, but neither
[`dropdown-menu.tsx`](../../../packages/ui/src/components/ui/dropdown-menu.tsx) nor
[`context-menu.tsx`](../../../packages/ui/src/components/ui/context-menu.tsx) wraps Radix's
`Sub` primitives, so it would mean extending the shared UI kit for one caller.

The dialog reads the folder list itself with `useArtifactFolders()`. The query is already cached
by the library view, and this keeps the two surfaces that do not fetch folders today
(sandbox home, chat sidebar) from having to start.

### Experiment folders are never a move target

Folders whose name starts with `EXPERIMENT_FOLDER_PREFIX` (`"Experiments / "`, exported from
`api-server-api`) are platform-managed. They hold experiment machinery: the dashboard artifact,
the script clone, the results snapshot. `artifacts-view.tsx` already splits `folders` into
`userFolders` and `experimentFolders` on that prefix and renders them in separate sections.

Both the picker and the drop targets offer **user folders only**. Nothing can be filed into
platform machinery. An artifact that already sits in an experiment folder can still be moved
out — its row menu works like any other, and the picker simply does not list its current folder
as an option.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 ✅ | [Move to folder in the row menu](./01-move-to-folder-menu.md) | `MoveArtifactDialog` plus an `onMove` action wired into all three row surfaces | — |
| 02 ✅ | [Drag a library row onto a folder](./02-drag-row-onto-folder.md) | Draggable rows and folder-group drop targets in the library view | 01 |

01 ships the whole goal on its own. 02 adds the accelerator on top of the same mutation call.

## Out of scope — follow-up

**Moving several artifacts at once.** The issue's fourth user story. No list view in this UI has
row multi-select today, so it needs selection state, a checkbox affordance, a bulk action bar,
and a decision on whether to loop N `update` calls or add a bulk procedure to the contract. It
is deliberately deferred to its own issue and is not part of this feature.

## Conventions & glossary

- **Folder** — a flat, owner-scoped group of artifacts. No nesting.
- **Ungrouped** — `folderId === null`. Rendered as a `FolderGroup` with `folder={null}` and the
  heading "Ungrouped".
- **User folder** — a folder whose name does not start with `EXPERIMENT_FOLDER_PREFIX`. Only
  these are move targets.
- **Move** — one `artifactLibrary.update` call carrying `folderId`. Not a copy: an artifact
  leaves its old folder by definition.

Apply the [`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md) skill
throughout — both sub-issues are `packages/ui` work. No server-side TypeScript is touched, so
`/typescript-engineering` does not come into play.

Repo rules that bite here:

- **No code comments.** Run `mise run common:check:comment-types` after each slice.
- Existing components set the house style. Copy `RenameArtifactDialog` for dialog shape and
  `use-file-row-drag.ts` for drag mechanics rather than inventing either.

## Whole-feature smoke test

On the dev cluster, with at least two folders and three artifacts in the library:

1. `mise run cluster:build-ui`, then open `http://localhost:4444` and go to **Artifacts**.
2. Row menu on an ungrouped artifact → **Move to folder…** → pick folder A → **Move**. The row
   appears under A. A's artifact count goes up by one.
3. Row menu on that artifact → **Move to folder…** → pick folder B. The row moves from A to B.
   Both counts correct.
4. Row menu again → **No folder**. The row returns to **Ungrouped**.
5. Drag a row from **Ungrouped** onto folder A's header. The header highlights while dragging,
   and the row lands in A on drop.
6. Drag that row onto the **Ungrouped** header. It leaves A.
7. Open a sandbox home page with published artifacts. **Move to folder…** works from that
   section too, and the library reflects it.
8. The **Experiments** section's folders never appear in a picker and never highlight as a drop
   target.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3231.
