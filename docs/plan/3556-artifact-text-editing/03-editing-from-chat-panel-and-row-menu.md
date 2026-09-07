# 03 — Editing from the chat panel and the row menu

**Depends on:** 02-editable-source-view-and-preview-dialog
**Part of:** A user can change the text of an artifact they own — see [README](./README.md)

## Context

Sub-issue 02 put the editor on the preview dialog. Two reading surfaces are still
read-only: the docked panel beside the chat conversation, which is where users read
an artifact most, and the row overflow menu, which offers Rename but no way to
change the text. This slice reuses the hook from 02 on both, so no editing logic is
written twice.

Apply the [`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md)
skill.

## Implementation plan

### 1. Edit mode in the docked panel

[`docked-artifact-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/docked-artifact-panel.tsx)
already loads the artifact, tracks `pinnedVersion` and renders `ArtifactSourceView`.
Wire in `useArtifactEditor` the same way the dialog does:

- The shown version is the head when `shownVersion === latest` — that is the hook's
  head input.
- Add **Edit** to the toolbar beside Share and Source, and swap it for **Save** and
  **Cancel** while editing. Match the dialog's arrangement so the two surfaces read
  the same.
- Force the source view while editing and hide the Source/Preview toggle, the
  Fullscreen button and the version switcher, as in the dialog.
- The panel's body already scrolls; give the editor the panel height rather than
  letting it grow.

This is the surface where the draft is most at risk. The docked preview follows new
versions as they are published, and an artifact update invalidates the whole
`artifactLibrary` query path, so `getContent` refetches under the open editor. The
hook's rule — reset the draft only while edit mode is off — is what keeps the draft
alive; confirm it holds here rather than assuming it.

Closing the panel while a draft is dirty must confirm first, the same way Cancel
does. Deleting the artifact under an open editor already closes the preview; make
sure that path does not strand a confirm dialog.

### 2. Edit in the row overflow menu

In [`artifact-row-menu-items.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row-menu-items.tsx),
add an `Edit` item above `Rename`, taking an `onEdit` callback like the others.
Show it only for text kinds — reuse the kind test rather than re-listing kinds
inline. The size cap cannot be checked here (the row has `sizeBytes` but the menu
has no loaded content), so a very large text artifact still shows the item and the
preview it opens then shows no **Edit** button. That is acceptable: the menu offers
to open the artifact for editing, and the editor is the authority on whether it can.

Add `onEdit` to `ArtifactRowActions` in
[`artifact-row.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-row.tsx)
and pass it through to the menu items.
[`folder-group.tsx`](../../../packages/ui/src/modules/artifacts/components/folder-group.tsx)
spreads `...rowActions` into `ArtifactRow`, so it needs no change.

### 3. Wiring per surface

The two reading surfaces are opened differently, so Edit resolves differently:

- **Artifacts page** — [`artifacts-view.tsx`](../../../packages/ui/src/modules/artifacts/views/artifacts-view.tsx)
  holds a `dialog` union (`{ kind: "preview", artifact }` at line 85). Add an
  `edit` flag to the preview variant and pass it to the dialog's `initialEdit`.
  `onEdit` sets `{ kind: "preview", artifact, edit: true }`.
- **Sandbox artifacts section** — [`sandbox-artifacts-section.tsx`](../../../packages/ui/src/modules/artifacts/components/sandbox-artifacts-section.tsx)
  keeps `previewTarget` as a single artifact. Carry the edit intent alongside it and
  pass `initialEdit` to the dialog.
- **Chat sidebar** — [`chat-artifacts-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/chat-artifacts-panel.tsx)
  opens artifacts through `setOpenArtifactId`, and the docked panel reads that from
  the store. So the intent has to travel through the store too: add
  `openArtifactEdit: boolean` and `setOpenArtifactEdit` to
  [`store.ts`](../../../packages/ui/src/modules/artifacts/store.ts), exactly like
  `openFileEdit` in the files slice. Edit sets the open id and the flag; the docked
  panel consumes the flag once and clears it, the way
  [`file-viewer.tsx`](../../../packages/ui/src/modules/files/components/file-viewer.tsx)
  does. Do not persist the flag — it is a one-shot intent, not a preference.
- **Home feed** — [`home-view.tsx`](../../../packages/ui/src/modules/home/views/home-view.tsx)
  opens the dialog from an artifact chip and has no row menu. It gets editing from
  the dialog's own Edit button with no change here.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass, and
      `mise run common:check:comment-types` passes.
- [ ] The docked panel offers **Edit** for a text artifact at its head version, and
      saving there bumps the version and re-renders.
- [ ] A dirty draft in the docked panel survives an agent publishing a new version
      of the same artifact.
- [ ] Closing the docked panel with a dirty draft asks before discarding.
- [ ] The row overflow menu shows **Edit** for text artifacts and hides it for
      binary ones, on the artifacts page, the sandbox section and the chat sidebar.
- [ ] Edit from the artifacts page or the sandbox section opens the preview dialog
      already in edit mode.
- [ ] Edit from the chat sidebar opens the docked panel already in edit mode, and
      opening the same artifact again afterwards opens it read-only — the intent
      does not stick.

## Smoke test

```bash
mise run check ::: mise run test
```

Then, on the dev cluster at `http://localhost:4444` (see the
[`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md) skill):

1. Open a chat session on an agent that has published a markdown artifact. In the
   session sidebar, open the artifact's overflow menu and choose **Edit**. The
   docked panel opens with the editor already active.
2. Change a line but do not save. Ask the agent to update the same artifact. The
   draft is still on screen.
3. Press **Save**. The overwrite confirm appears (the head moved). Confirm, and the
   panel shows your text as the newest version.
4. Close the panel with a fresh unsaved change. It asks before discarding.
5. Re-open the same artifact from the sidebar by clicking the row. It opens
   read-only.
6. On the **Artifacts** page, choose **Edit** in a row's menu. The preview dialog
   opens in edit mode. Check the same menu on a binary artifact — no **Edit** item.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
