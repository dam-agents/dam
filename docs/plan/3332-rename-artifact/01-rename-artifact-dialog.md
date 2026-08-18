# 01 — Rename an artifact from the row menu

**Part of:** Rename an artifact from the library — see [README](./README.md)

## Context

Add a `Rename…` item to the artifact row menu, in the Artifacts library and in the chat
sidebar, backed by a small one-field dialog. The backend already accepts a title-only
`artifactLibrary.update`, so this slice is entirely in `packages/ui`. Apply the
**`/react-ui-engineering`** skill.

## Implementation plan

### 1. Invalidate `get` after an update

[`packages/ui/src/modules/artifacts/api/mutations.ts`](../../../packages/ui/src/modules/artifacts/api/mutations.ts)

Add `trpc.artifactLibrary.get.queryKey()` to `invalidatesLibraryAndContent`. Leave
`invalidatesLibrary` alone — it is shared with `delete`, where refetching a removed
artifact would raise an error toast.

Without this, the docked artifact panel header
([`docked-artifact-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/docked-artifact-panel.tsx))
and the chat link chip
([`artifact-link-chip.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-link-chip.tsx))
keep the old title after a rename.

### 2. Add the dialog

New file:
`packages/ui/src/modules/artifacts/components/rename-artifact-dialog.tsx`

Model it on
[`folder-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/folder-dialog.tsx)
— same imports, same layout, same `DialogActions` wiring:

- Props: `{ artifact: LibraryArtifact; onClose: () => void }`.
- `const [title, setTitle] = useState(artifact.title)`.
- `const update = useUpdateArtifact()` from
  [`api/mutations.ts`](../../../packages/ui/src/modules/artifacts/api/mutations.ts).
- `save()`: trim the value; return early when it is empty; close without a mutation when
  it equals `artifact.title`; otherwise
  `update.mutate({ id: artifact.id, title: trimmed }, { onSuccess: onClose })`.
- `Modal` + `DialogHeader title="Rename artifact"` + a `Title` field using `Input`
  (`size="sm"`, `autoFocus`, `maxLength={300}` to match `titleSchema`, Enter calls
  `save()`).
- `DialogActions` with `label="Save"`, `pendingLabel="Saving…"`,
  `pending={update.isPending}`, `disabled={!title.trim()}`.

Failures surface through the mutation's existing `errorToast` meta — no local error
state.

### 3. Add the menu item

[`artifact-row-menu-items.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row-menu-items.tsx)

- Add an `onRename: (artifact: LibraryArtifact) => void` prop beside `onShare`.
- Render `Rename…` as the **first** item, above `Share`:
  `<DropdownMenuItem onSelect={() => onRename(artifact)}>Rename…</DropdownMenuItem>`.
  The ellipsis marks that it opens a dialog, matching
  [`file-row-menu-items.tsx`](../../../packages/ui/src/modules/files/components/file-row-menu-items.tsx).

The dialog is **not** rendered here. A dialog inside `DropdownMenuContent` unmounts when
the menu closes on select, which is why `onShare` already delegates to the parent.

### 4. Extend the shared row actions

[`artifact-row.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row.tsx)

Add `onRename: (artifact: LibraryArtifact) => void` to the exported
`ArtifactRowActions` interface and pass it through to `ArtifactRowMenuItems`.

[`folder-group.tsx`](../../../packages/ui/src/modules/artifacts/components/folder-group.tsx)
and
[`experiments-section.tsx`](../../../packages/ui/src/modules/artifacts/components/experiments-section.tsx)
already spread `...rowActions` / `...actions` into `ArtifactRow`, so they need no edit —
the new prop flows through their `ArtifactRowActions` extension. TypeScript will point at
any caller that has not been updated.

### 5. Host the dialog in the three surfaces

Each host already holds a `shareTarget` state and renders `ShareDialog`. Mirror it with
`renameTarget` and `RenameArtifactDialog`:

- [`views/artifacts-view.tsx`](../../../packages/ui/src/modules/artifacts/views/artifacts-view.tsx)
  — add the state, add `onRename: setRenameTarget` to the `rowActions` object, and render
  the dialog beside `ShareDialog`.
- [`sandbox-artifacts-section.tsx`](../../../packages/ui/src/modules/artifacts/components/sandbox-artifacts-section.tsx)
  — add the state, pass `onRename={setRenameTarget}` to `ArtifactRow`, render the dialog.
- [`chat-artifacts-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/chat-artifacts-panel.tsx)
  — add the state on `ChatArtifactsPanel`, thread an `onRename` prop into
  `ArtifactListRow` next to `onShare`, and render the dialog beside `ShareDialog`.

## Acceptance criteria

- [ ] The row menu in the Artifacts library shows `Rename…` above Share, Download and
      Delete.
- [ ] The row menu in the sandbox home Artifacts section shows the same item.
- [ ] The artifact menu in the chat sidebar shows the same item.
- [ ] Choosing `Rename…` opens a dialog pre-filled with the current title, focused, with
      the text ready to edit.
- [ ] Save renames the artifact, closes the dialog, and updates the title everywhere it
      shows — the library row, the chat sidebar row, an open docked panel header, and a
      link chip in the conversation.
- [ ] Enter saves; Cancel and Escape close without a change.
- [ ] Save stays disabled while the field is empty or whitespace.
- [ ] Renaming an **agent-published** artifact works the same as renaming an uploaded one.
- [ ] The share link, the version number and the view count are unchanged after a rename,
      and an open share link still resolves.
- [ ] `mise run check` and `mise run test` pass.
- [ ] `mise run common:check:comment-types` passes — no new code comments.

## Smoke test

Run the existing checks:

```bash
mise run check ::: test
```

Then confirm by hand on the dev cluster (`mise run cluster:status` first; see the
`cluster-ops` skill if it is not up):

1. Open `http://localhost:4444` and go to **Artifacts**.
2. Pick a row published by an agent. Note its version badge, view count, and share link.
3. Open the row menu → **Rename…**, change the title, press Enter.
4. The row shows the new title at once. The version badge and view count are unchanged.
5. Open the share link in a private window — it still resolves, and the page banner shows
   the new title.
6. Open a chat session for the same sandbox. In the sidebar **Artifacts** section, open
   the same artifact in the docked panel, then rename it from the sidebar row menu. The
   docked panel header updates without a page reload.
7. Clear the title and confirm Save is disabled. Press Escape and confirm nothing changed.

The implementing agent runs this itself, then prints a short manual smoke-test guide so
the user can confirm it by hand.
