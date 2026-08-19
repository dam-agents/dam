# 02 — Drag a library row onto a folder

**Depends on:** [01-move-to-folder-menu](./01-move-to-folder-menu.md)
**Part of:** Move an existing artifact into a folder — see [README](./README.md)

## Context

Slice 01 makes every move possible but each one costs a menu, a dialog and a submit. Tidying a
long library that way is slow. This slice adds the accelerator the issue asks for: drag an
artifact row onto a folder group and drop it. The Files tree already does this for files, so the
library matches a gesture users have seen in this app. It lands in the Artifacts library view
only — that is the one place folders and rows share a screen.

## Implementation plan

All paths are relative to
[`packages/ui/src/modules/artifacts/`](../../../packages/ui/src/modules/artifacts/) unless noted.

Read [`packages/ui/src/modules/files/hooks/use-file-row-drag.ts`](../../../packages/ui/src/modules/files/hooks/use-file-row-drag.ts)
and [`file-row.tsx`](../../../packages/ui/src/modules/files/components/file-row.tsx) first. They
are the pattern to follow: a custom MIME type carries the dragged identity, the row hook returns
a spread-able bag of drag handlers, and the owning panel holds the "which target is hot" state.
Do not import them — files carry paths and directories, artifacts carry ids and a nullable folder.

### 1. The drag hook — `hooks/use-artifact-row-drag.ts` (new)

Mirror the shape of `use-file-row-drag.ts`, trimmed to this feature:

- `export const ARTIFACT_MOVE_MIME = "application/x-platform-artifact-move";` — a distinct type,
  so a file drag never looks like an artifact drag and the reverse.
- A source payload of `{ id: string }` serialised as JSON. Provide `hasArtifactMove(e)` and
  `readArtifactMoveSource(e)` helpers, matching the `hasMove` / `readMoveSource` pair in the files
  hook, including its `try/catch` around `JSON.parse` and its shape check on the parsed value.
- `useArtifactRowDrag(id, { onEnd })` returns `draggable: true`, `onDragStart` (sets the MIME
  payload and `effectAllowed = "move"`) and `onDragEnd`. Rows are sources only — an artifact is
  never a drop target, since folders are flat and an artifact cannot contain another.
- `useFolderDropTarget(folderId, { onEnter, onLeave, onDrop })` returns the target handlers:
  `onDragEnter`, `onDragOver` (setting `dropEffect = "move"`), `onDragLeave` and `onDrop`. Ignore
  any drag that does not carry `ARTIFACT_MOVE_MIME`, so an OS file drag falls through untouched.
  `folderId` is `string | null` — `null` is the **Ungrouped** target, and dropping there takes the
  artifact out.
- Copy the `onDragLeave` guard from the files hook verbatim in spirit:
  `if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;`. Without it the
  highlight flickers as the pointer crosses child elements.
- Memoise the returned handler bags with `useMemo`, as the files hook does, so a drag does not
  re-render every row.

### 2. Rows become drag sources — `components/artifact-row.tsx`

- Accept an optional `onDragStateChange?: (dragging: boolean) => void` (or an equivalent single
  optional prop) and an optional flag that turns dragging on. Keep dragging **opt-in**: the
  sandbox home section renders the same component with no folders on screen, and a draggable row
  there would be a gesture that leads nowhere.
- Spread the hook's handlers onto the existing root `div`.
- The row is already a click target via `clickableProps(() => onPreview(artifact))`. Verify a
  click still opens the preview after a drag ends and that a completed drag does **not** fire the
  preview. `file-row.tsx` solves the same overlap; follow whatever it does (note its
  `onMouseDown` / `onClick` `stopPropagation` on nested controls).
- While this row is the drag source, dim it slightly so the user can see what is moving. Reuse an
  existing opacity utility rather than adding a new one.

### 3. Groups become drop targets — `components/folder-group.tsx`

- Accept optional drop props: whether this group is the hot target, and the handler bag from
  `useFolderDropTarget`. Optional again, because `experiments-section.tsx` renders `FolderGroup`
  too and experiment folders must never accept a drop.
- Spread the handlers on the group's outer `Wrapper`, so the whole card accepts the drop, not just
  its header strip. A collapsed folder must still accept a drop.
- When hot, highlight the group. `file-row.tsx` uses a `highlight` boolean driven by
  `dropActive`; match that visual language with the tokens already used in this module rather than
  inventing a new colour.
- A drop of an artifact already in this folder is a no-op: fire no mutation.

### 4. The view owns the state — `views/artifacts-view.tsx`

- Hold the hot target in one piece of state, keyed by folder id with `null` for **Ungrouped** —
  a `string | null | undefined` where `undefined` means "no drag in progress" distinguishes
  "hovering Ungrouped" from "hovering nothing".
- Build the drop handlers per rendered `userFolders` group and for the `ungrouped` group. Pass
  **nothing** to `ExperimentsSection`, so experiment folders stay inert.
- On drop, call the same `useUpdateArtifact()` mutation slice 01 uses:
  `update.mutate({ id, folderId })`, with `folderId` the target folder's id or `null`. Look the
  artifact up in the already-loaded `artifacts` array to skip a no-op drop.
- Clear the hot target on drop and on drag end.
- Note the interaction with search: `byFolder` is built from the **filtered** list, so a folder
  group can be on screen showing a subset. Dropping is still correct — the mutation carries ids,
  not positions.

### 5. Housekeeping

`mise run ui:fix`, then `mise run common:check:comment-types`. The drag handlers are the kind of
code that invites explanatory comments; the repo bans them, so name the helpers well instead.

## Acceptance criteria

- [ ] `mise run ui:check` passes (tsc, eslint, prettier).
- [ ] `mise run common:check:comment-types` passes.
- [ ] A row in the Artifacts library can be dragged; the folder group under the pointer
      highlights, and other groups do not.
- [ ] Dropping on a user folder moves the artifact into it, with counts updating and no reload.
- [ ] Dropping on the **Ungrouped** group takes the artifact out of its folder.
- [ ] Dropping an artifact on the folder it already sits in fires no mutation.
- [ ] Groups in the **Experiments** section never highlight and never accept a drop.
- [ ] Dragging an OS file over the library changes nothing — the artifact drop targets ignore it.
- [ ] The highlight clears when the drag ends anywhere, including a drag abandoned with Escape or
      released outside any group.
- [ ] Clicking a row still opens its preview, and finishing a drag does not open the preview.
- [ ] The **Move to folder…** menu item from slice 01 still works — drag is an addition, not a
      replacement.
- [ ] Rows in the sandbox home Artifacts section and the chat sidebar are not draggable.

## Smoke test

```bash
mise run ui:check ::: mise run common:check:comment-types
```

Then, against the dev cluster (`mise run cluster:build-ui`, `http://localhost:4444`), on the
**Artifacts** page with at least two folders, one ungrouped artifact and one artifact in a folder:

1. Drag the ungrouped row over the first folder's card. Only that card highlights.
2. Drop it. The row is now inside that folder; the count rose by one.
3. Drag it from there onto the second folder. It moves across; both counts are right.
4. Drag it onto the **Ungrouped** card. It leaves the folder.
5. Drag a row and release it over empty page space. Nothing moves and no highlight is left behind.
6. Drag a row over a folder in the **Experiments** section. No highlight, and a drop changes
   nothing.
7. Collapse a folder, then drop a row on its collapsed card. The move still happens.
8. Click a row without dragging. The preview dialog opens as before.
9. Confirm the menu path from slice 01 still moves an artifact.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
