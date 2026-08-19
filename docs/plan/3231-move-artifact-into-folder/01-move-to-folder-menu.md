# 01 — Move to folder in the row menu

**Part of:** Move an existing artifact into a folder — see [README](./README.md)

## Context

The artifact row overflow menu offers Rename, Share, Download, "Delete after…" and Delete —
nothing files the artifact anywhere. This slice adds **Move to folder…** to that menu and a
dialog behind it. The dialog holds one folder value plus a "No folder" choice, so the same
control covers filing an artifact, moving it between folders, and taking it out. It is the
accessible primary path and it works in every surface that renders an artifact row.

## Implementation plan

All paths are relative to
[`packages/ui/src/modules/artifacts/`](../../../packages/ui/src/modules/artifacts/).

### 1. The dialog — `components/move-artifact-dialog.tsx` (new)

Model it on `components/rename-artifact-dialog.tsx`: same `Modal` / `DialogHeader` /
`DialogBody` / `DialogActions` shape, same Escape-key handling, same "close on success" via the
mutation's `onSuccess`.

```
interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}
```

- Read folders with `useArtifactFolders()` from `../api/queries.js`. Do not accept them as a
  prop — the two non-library surfaces do not fetch folders today.
- Filter the options to user folders: drop any folder whose `name` starts with
  `EXPERIMENT_FOLDER_PREFIX` (import from `api-server-api`, exactly as
  `views/artifacts-view.tsx` does).
- Local state holds the chosen folder id as a string, `""` meaning "No folder". Initialise it
  from `artifact.folderId ?? ""`. When the artifact's current folder is an experiment folder it
  is not in the option list, so the select falls back to `""` — acceptable, and the user still
  ends up moving it somewhere valid.
- Use `Select` from `@/components/ui/select` with `<option value="">No folder</option>` first,
  then one option per user folder. This mirrors the folder field in
  `components/upload-artifact-dialog.tsx`.
- Submit calls `useUpdateArtifact()` from `../api/mutations.js`:
  `update.mutate({ id: artifact.id, folderId: chosen === "" ? null : chosen }, { onSuccess: onClose })`.
  Nothing else goes in the payload — `title`, `content` and `fileName` stay absent so the update
  touches only the folder.
- Short-circuit a no-op: if the chosen value equals `artifact.folderId ?? ""`, just `onClose()`.
  `RenameArtifactDialog` does the same for an unchanged title.
- Disable submit while `update.isPending`; label the action **Move** with pending label
  **Moving…**. `useUpdateArtifact` already carries `errorToast: "Failed to update artifact"`, so
  the dialog needs no error state of its own.
- If the library holds no user folder at all, show a short line explaining that there is nowhere
  to move to yet and leave only "No folder" selectable. Keep it to one sentence.

### 2. The menu item — `components/artifact-row-menu-items.tsx`

Add `onMove: (artifact: LibraryArtifact) => void` to the props and a `DropdownMenuItem` for it.
Place **Move to folder…** directly after **Rename** — both reshape where the artifact lives,
while Share and Download act on its content. The existing `DropdownMenuSeparator` before
"Delete after…" stays where it is.

### 3. The row contract — `components/artifact-row.tsx`

Add `onMove: (artifact: LibraryArtifact) => void` to the exported `ArtifactRowActions` interface,
destructure it, and pass it to `ArtifactRowMenuItems`.

`components/folder-group.tsx` and `components/experiments-section.tsx` both spread row actions
(`...rowActions`) and re-export the type, so they need **no change** — they pick the new action up
for free. Confirm this with `mise run ui:check:tsc` rather than by reading.

### 4. Surface A — `views/artifacts-view.tsx`

- Add `| { kind: "move"; artifact: LibraryArtifact }` to the `ArtifactDialog` union.
- Add `onMove: (artifact) => setDialog({ kind: "move", artifact })` to the `rowActions` object.
- Render `{dialog?.kind === "move" && <MoveArtifactDialog artifact={dialog.artifact} onClose={closeDialog} />}`
  beside the other dialog cases.

### 5. Surface B — `components/sandbox-artifacts-section.tsx`

Add a `moveTarget` state alongside `renameTarget` / `shareTarget` / `retentionTarget`, pass
`onMove={setMoveTarget}` to `ArtifactRow`, and render the dialog with the same
`{moveTarget && …}` shape the neighbours use.

### 6. Surface C — `components/chat-artifacts-panel.tsx`

Same three edits, one level deeper: the local `ArtifactListRow` declares its own callback props,
so add `onMove` there too and forward it to `ArtifactRowMenuItems`. The panel owns the
`moveTarget` state and renders `MoveArtifactDialog`.

### 7. Housekeeping

Run `mise run ui:fix` for lint and formatting, then
`mise run common:check:comment-types` — the repo bans code comments and this slice adds none.

## Acceptance criteria

- [ ] `mise run ui:check` passes (tsc, eslint, prettier).
- [ ] `mise run common:check:comment-types` passes.
- [ ] The row overflow menu shows **Move to folder…** in the library view, the sandbox home
      Artifacts section, and the chat session sidebar.
- [ ] Choosing a folder moves the artifact: the row is rendered under that folder's group and the
      folder's artifact count changes, with no page reload.
- [ ] Choosing **No folder** on an artifact inside a folder returns it to the **Ungrouped** group.
- [ ] Choosing a different folder moves it between the two, and both counts settle correctly.
- [ ] The picker lists no folder whose name starts with `Experiments / `.
- [ ] Submitting the folder the artifact is already in closes the dialog and fires no mutation.
- [ ] No new tRPC procedure, schema field or migration was added.

## Smoke test

```bash
mise run ui:check ::: mise run common:check:comment-types
```

Then, against the dev cluster (`mise run cluster:build-ui`, `http://localhost:4444`):

1. Go to **Artifacts**. Create two folders if none exist ("New folder").
2. On an **Ungrouped** artifact: row menu → **Move to folder…** → pick the first folder →
   **Move**. The row appears under that folder and the count rises by one.
3. Repeat on the same artifact, picking the second folder. It moves across; both counts are right.
4. Repeat, picking **No folder**. It returns to **Ungrouped**.
5. Open a sandbox home page with published artifacts, use **Move to folder…** there, and confirm
   the Artifacts library shows the artifact in its new folder.
6. Open a session with published artifacts, use **Move to folder…** in the sidebar Artifacts
   panel, and confirm the same.
7. Confirm no `Experiments / …` folder is offered in any of those pickers.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
