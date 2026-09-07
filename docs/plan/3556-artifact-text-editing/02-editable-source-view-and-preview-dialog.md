# 02 — Editable source view and the preview dialog

**Depends on:** 01-version-authorship-and-stale-save-guard
**Part of:** A user can change the text of an artifact they own — see [README](./README.md)

## Context

This slice builds the editor once and lands it on the preview dialog — the surface
the artifacts page, the sandbox artifacts section and the Home feed chips all open.
The editing state lives in a hook rather than in the dialog, so sub-issue 03 can
put the same editor in the chat docked panel without repeating the logic.

Apply the [`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md)
skill.

## Implementation plan

### 1. Editability helper

New file `packages/ui/src/modules/artifacts/lib/editable.ts`, beside
[`kinds.ts`](../../../packages/ui/src/modules/artifacts/lib/kinds.ts):

```ts
import { INLINE_CONTENT_MAX_BYTES, type ArtifactContent } from "api-server-api";

export function isEditableContent(content: ArtifactContent | undefined): boolean {
  if (!content || content.binary || content.tooLarge) return false;
  return new TextEncoder().encode(content.content).length <= INLINE_CONTENT_MAX_BYTES;
}
```

The byte check is the point of the helper, not decoration. `getContent` hands back
text up to 10 MB while an inline update accepts 2 MB, so without it a large text
artifact opens in the editor and fails on save. `INLINE_CONTENT_MAX_BYTES` is
already exported from the contract package and lives in the browser-safe
`schemas.ts`.

### 2. A save mutation the editor owns

In [`api/mutations.ts`](../../../packages/ui/src/modules/artifacts/api/mutations.ts),
add `useSaveArtifactContent` rather than reusing `useUpdateArtifact`. Two reasons:
the existing hook optimistically patches list rows for title, file name and folder,
which a content save has no business touching; and it carries
`errorToast: "Failed to update artifact"`, which would fire a generic toast
underneath the conflict dialog.

Set `meta.suppressErrorToast: true` (the flag
[`query-client.ts:70`](../../../packages/ui/src/query-client.ts) honours) so the
editor is the only thing that speaks on failure, and
`meta.invalidates: invalidatesLibraryAndContent` so the list, the artifact, the
content and the preview all refresh after a successful save.

### 3. The editor hook

New file `packages/ui/src/modules/artifacts/hooks/use-artifact-editor.ts`,
modelled on [`file-viewer.tsx`](../../../packages/ui/src/modules/files/components/file-viewer.tsx)
— read it first; it already solved this shape.

Input: the artifact, the loaded `ArtifactContent`, whether the shown version is
the head, and an optional `initialEdit` flag. Output: `editable`, `editing`,
`draft`, `dirty`, `saving`, `setDraft`, `startEdit`, `cancelEdit`, `save`.

Rules:

- `editable` is `isEditableContent(content)` **and** the shown version is the head.
  A past version is read-only — restoring one is not in this feature's scope.
- Sync `draft` from `content.content` only while `editing` is false. This is the
  live-update rule from the README: a version publish invalidates the content
  query and refetches under an open editor, and resetting unconditionally would
  wipe the draft.
- `dirty` is `editing && draft !== content.content`. Call `useUnsavedGuard(dirty)`
  ([`use-unsaved-guard.ts`](../../../packages/ui/src/hooks/use-unsaved-guard.ts))
  so a browser close warns.
- `save` calls the mutation with `{ id, content: draft, expectedVersion: artifact.version }`,
  then leaves edit mode and emits a success toast via
  [`emitToast`](../../../packages/ui/src/lib/toast.ts).
- On failure, read the code the way the rest of the app does:
  `err instanceof TRPCClientError && err.data?.code === "CONFLICT"`
  (as in [`connection-update-credential-dialog.tsx:113`](../../../packages/ui/src/modules/connections/components/connection-update-credential-dialog.tsx)).
  A conflict opens `showConfirm` from the store: *"This artifact has a newer
  version. Overwrite it with your changes?"* Confirming re-runs the mutation
  **without** `expectedVersion`, which the server appends on the current head.
  Declining keeps the draft dirty so the user can copy the text out, and leaves
  edit mode on.

  This is the deliberate reading of "refuse the stale save": the default refuses,
  so nothing is ever silently replaced, and the owner may still choose to
  overwrite once told. It is also what `FileViewer` does on an mtime conflict.
- Any other failure emits an error toast built from
  [`getErrorMessage`](../../../packages/ui/src/lib/errors.ts).
- `cancelEdit` confirms first when dirty (*"Discard unsaved changes?"*), then
  resets the draft and leaves edit mode.

### 4. Editable source view

[`artifact-source-view.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-source-view.tsx)
today renders `HighlightedCode` for text and an inline image or a note otherwise.
Add optional `editMode`, `draft`, `onDraftChange` and `onSave` props. When
`editMode` is on, render `CodeEditor`
([`code-editor.tsx`](../../../packages/ui/src/modules/files/components/code-editor.tsx))
with `value={draft}`, `path={content.fileName}` and the callbacks; otherwise keep
today's behaviour untouched.
[`file-preview-body.tsx`](../../../packages/ui/src/modules/files/components/file-preview-body.tsx)
is the pattern to copy. Passing the file name as `path` is what gives the editor
its language mode, so markdown, JSX and JSON all highlight without new mapping code.

The editor needs bounded height to scroll: the dialog gives its body a fixed
height already, so wrap the editor so it fills that box rather than growing the
dialog.

### 5. Edit mode in the preview dialog

In [`artifact-preview-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-preview-dialog.tsx):

- Accept an optional `initialEdit` prop and pass it to the hook. Sub-issue 03 uses
  it for the row menu's Edit entry; nothing sets it yet.
- Add an **Edit** button to the toolbar row that holds Source and Fullscreen, shown
  only while `editable` and not editing. Use the `Edit` icon from
  `@carbon/icons-react`, the one `FileViewer` uses, so the meaning carries over.
- While editing, replace Edit with **Save** and **Cancel**, disable Save unless
  `dirty`, and show a pending label while saving — the same arrangement as
  `FileViewer`'s toolbar.
- Editing a renderable kind shows the source, not the rendered frame: force
  `showSource` on when edit mode starts, and hide the Source/Preview toggle and
  the Fullscreen button while editing.
- While dirty, hide or disable the `VersionSwitcher`. Stepping to another version
  under an open editor would swap the content the draft is compared against.
- Mark the title as dirty the way `FileViewer` does — a leading `●` on the header
  title.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass, and
      `mise run common:check:comment-types` passes.
- [ ] A markdown, code, text, HTML or JSX artifact shows **Edit** in the preview
      dialog; a binary one does not.
- [ ] A text artifact larger than the inline cap does not show **Edit**.
- [ ] A past version shows no **Edit** — only the head is editable.
- [ ] Editing, then saving, bumps the version badge and shows the new text in the
      rendered preview.
- [ ] Save is disabled until the text actually changes.
- [ ] Cancel with unsaved changes asks before discarding; Cancel with no changes
      exits straight away.
- [ ] A save whose version has moved on shows the overwrite confirm; declining
      keeps the draft and the editor open.
- [ ] A failed save shows exactly one message, not a generic toast as well.
- [ ] The version switcher cannot move the shown version while a draft is dirty.

## Smoke test

```bash
mise run check ::: mise run test
```

Then, on the dev cluster at `http://localhost:4444` (see the
[`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md) skill):

1. Open **Artifacts**, open a markdown artifact, press **Edit**, change a line and
   press `Cmd/Ctrl+S`. The badge goes v1 → v2 and the rendered preview shows the
   change.
2. Re-open the dialog and step back to v1. **Edit** is gone.
3. Open the same artifact in a second browser tab. Start an edit in tab A. In tab B
   edit and save. Back in tab A, save: the overwrite confirm appears. Decline — the
   draft is still there. Save again and confirm — the text lands as a further version.
4. Open an uploaded image artifact. There is no **Edit** button.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
