# 01 — Expand the docked artifact preview to full screen

**Part of:** Expand an artifact to full screen from the chat view — see [README](./README.md)

## Context

The chat's docked artifact panel has no way to make the artifact bigger. This slice adds
the expand control to its header and renders the preview through the full-screen shell
the library preview and the chat file panel already share. It is the entire feature.

## Implementation plan

All edits are in
[`packages/ui/src/modules/artifacts/components/docked-artifact-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/docked-artifact-panel.tsx).
Apply the `/react-ui-engineering` skill. Read
[`file-viewer.tsx`](../../../packages/ui/src/modules/files/components/file-viewer.tsx)
(the expand button around line 246 and the dialog around line 283) first — it is the
pattern this slice follows.

1. **Imports.** Add `Maximize` to the existing `@carbon/icons-react` import. Import
   `FullscreenPreviewDialog` from
   `../../files/components/fullscreen-preview-dialog.js`. (Cross-module import into
   `files` — the same one `artifact-preview-dialog.tsx` already makes.)

2. **State.** Add one local flag beside the existing `showSource` / `shareOpen` state:
   `const [fullscreen, setFullscreen] = useState(false)`. Local state is right — the panel
   is keyed by `openArtifactId` in
   [`chat-view.tsx`](../../../packages/ui/src/modules/sessions/views/chat-view.tsx), so
   selecting a different artifact remounts and resets it. Do not put it in the store.

3. **Derive whether the overlay shows.** Do not synchronize the flag with the other
   state. Compute a single derived value — the request flag **and** `showFrame` **and**
   `preview.data` being present. Use that derived value both to decide the control's
   visibility and to decide whether to render the overlay, so switching to Source or
   losing preview content cannot leave an empty overlay open.

4. **Hoist the frame into one element.** The `DeferredFrame` in the panel body (currently
   inside the `showFrame ? preview.data ? …` branch) becomes a variable rendered in
   exactly one place — the panel body when not expanded, the overlay when expanded. Keep
   its existing props unchanged: `key={`${artifact.id}@${shownVersion}`}`, `html`,
   `title`, `className="h-full w-full bg-white"`, `deferMs={0}`, and
   `postData={feedPostForShown}`. That `className` works in both parents — the overlay's
   body is a `flex-1` box with a definite height, the same shape the library's full-screen
   copy relies on. Passing `postData` through matters: it is how a dashboard artifact
   receives its feed data, and dropping it would make the full-screen view render an empty
   dashboard.

5. **Placeholder in the panel while expanded.** Where the frame used to be, render the
   same kind of short centered muted line the file viewer uses (`Opened in fullscreen`),
   so the docked panel does not read as a blank or broken box behind the overlay.

6. **The control.** Add a button to the header between the Download button and Close,
   rendered only when the derived value from step 3 says the frame is showing:

   ```tsx
   <Button
     variant="ghost"
     size="icon-sm"
     aria-label="Open fullscreen"
     tooltip="Open fullscreen"
     onClick={() => setFullscreen(true)}
   >
     <Maximize size={16} />
   </Button>
   ```

   Placement before Close matches the library preview (its `Maximize` is the last control
   before the header's close affordance) and the file viewer. The `Open fullscreen` copy
   matches the chat's other docked panel — the file viewer — which is the surface a user
   sees next to this one; the library dialog says `Fullscreen`. Either reads correctly;
   pick the chat-local wording and leave the library alone (out of scope).

7. **The overlay.** After the existing `ShareDialog` block, render the shell when the
   derived value is true:

   ```tsx
   <FullscreenPreviewDialog
     title={artifact.title}
     onClose={() => setFullscreen(false)}
   >
     {frame}
   </FullscreenPreviewDialog>
   ```

   `FullscreenPreviewDialog` already owns Esc-to-exit, the body scroll lock, the portal,
   and `role="dialog"` / `aria-modal`. Add none of that here. There is no competing global
   Esc handler in the chat view — verified: the only other `Escape` listeners in
   `packages/ui/src` are inside `searchable-select.tsx` and `inline-name-row.tsx`.

8. **Checks.** Run `mise run ui:fix` (it auto-fixes import order and `import type`), then
   `mise run ui:check` and `mise run common:check:comment-types`.

Do not touch the library dialog, the file viewer, the panel's other controls, or the
`DeferredFrame` component itself.

## Acceptance criteria

- [ ] The docked artifact panel header shows a `Maximize` control while it renders the
      artifact preview, positioned before Close.
- [ ] The control is absent while the panel shows Source, and absent while the preview has
      no content to show (loading, or no preview available).
- [ ] Clicking it renders the artifact full screen through `FullscreenPreviewDialog`.
- [ ] `Esc` and the overlay's Close button both return to the conversation, with the chat
      and the docked panel unchanged — same artifact, same version, same scroll position.
- [ ] Exactly one `DeferredFrame` for the artifact is mounted at any moment.
- [ ] The full-screen view shows the version the panel had selected, and a dashboard
      artifact still receives its feed data there.
- [ ] `mise run ui:check`, `mise run ui:test`, and
      `mise run common:check:comment-types` pass.

## Smoke test

Run the existing checks:

```bash
mise run ui:check ::: ui:test ::: common:check:comment-types
```

Then, on the dev cluster (`http://localhost:4444`; see the `cluster-ops` skill if it is
not up), walk the [README's whole-feature smoke test](./README.md#whole-feature-smoke-test)
— open an HTML artifact from a session's Artifacts section, expand it, exit with `Esc`,
exit again with Close, and confirm the control disappears in Source view.

The implementing agent runs this itself, then prints a short manual smoke-test guide so
the user can confirm it by hand.
