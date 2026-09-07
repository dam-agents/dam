# 02 — Preview dialog: share from the opened artifact

**Depends on:** [01-list-row-share-controls](./01-list-row-share-controls.md)
**Part of:** Make artifact sharing visible — see [README](./README.md)

## Context

Opening an artifact is currently a dead end for sharing: the preview dialog
offers **Open share page** only once the artifact is already public, and nothing
that starts sharing. This slice gives the dialog a status badge, a **Copy link**
control when public, and an always-present **Share** button that stacks the
share dialog over the preview — so a user never has to close the artifact and
hunt for the row again.

It depends on slice 01 only for the non-interactive form of
`ArtifactStatusBadge` (the badge here is a label; **Share** in the footer is the
control).

All three mount sites —
[`artifacts-view.tsx`](../../../packages/ui/src/modules/artifacts/views/artifacts-view.tsx),
[`sandbox-artifacts-section.tsx`](../../../packages/ui/src/modules/artifacts/components/sandbox-artifacts-section.tsx)
and the Home feed's chips in
[`home-view.tsx`](../../../packages/ui/src/modules/home/views/home-view.tsx) —
inherit this slice without being edited.

## Implementation plan

Apply the `/react-ui-engineering` skill throughout. All edits are in
[`packages/ui/src/modules/artifacts/components/artifact-preview-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-preview-dialog.tsx)
unless stated otherwise.

### 1. Read live artifact state

This step is not cosmetic, and it is the one thing in this slice that fails
silently if skipped. Callers pass a `LibraryArtifact` snapshot captured when the
row was clicked — `artifacts-view.tsx` passes `dialog.artifact` out of its
dialog state. So once step 4 lets the user change sharing from inside the
preview, the snapshot goes stale: the badge would keep saying `Private` and
**Copy link** would stay hidden until the dialog was closed and reopened.

- Rename the prop to `initialArtifact` and derive
  `const artifact = useArtifact(initialArtifact.id).data ?? initialArtifact;`,
  keeping the prop as the fallback so the dialog renders immediately and still
  works if the query fails (`useArtifact` is already `retry: false`).
- `useArtifact` is exported from
  [`../api/queries.js`](../../../packages/ui/src/modules/artifacts/api/queries.ts)
  and `useSetArtifactSharing` already invalidates
  `artifactLibrary.get`([`mutations.ts`](../../../packages/ui/src/modules/artifacts/api/mutations.ts)),
  so no new plumbing and no cache wiring is needed.
- Everything downstream then reads the live object. Leave the `version` state
  initialiser as it is; its behaviour is unchanged.

### 2. Status badge into the toolbar

The toolbar is the `mb-3 flex items-center gap-2 …` strip inside `DialogBody`.

Put `<ArtifactStatusBadge artifact={artifact} />` first, before the filename, as
the frames show. Pass **no** `onShare` — in this dialog the badge is a label and
**Share** in the footer is the control. Slice 01 keeps that non-interactive form
working.

Note the strip is `font-mono text-xs`; make sure the badge does not inherit
styling that fights its own.

### 3. Copy link in the toolbar, only when public

Add a **Copy link** button when `artifact.shareUrl` is set, positioned after the
`VersionSwitcher` and before the Source toggle. When it is absent the version
switcher shifts right to fill the gap, which the frames confirm — so no
placeholder or disabled state.

- Unlike the row's borderless version, the frames show this one bordered like
  the neighbouring **Source** button: `variant="outline"` `size="xs"` with the
  `Link` icon and the label `Copy link`.
- Reuse `useCopy`
  ([`use-copy.ts`](../../../packages/ui/src/hooks/use-copy.ts)) and
  `toastCopyOutcome`
  ([`share-link.ts`](../../../packages/ui/src/modules/artifacts/lib/share-link.ts)),
  with the same `Checkmark` copied state as the row. Write no new clipboard
  handling.
- The Source and Fullscreen buttons stay gated on `renderable`. **Copy link** is
  not — it is gated on `shareUrl` only.

### 4. Share in the footer, replacing Open share page

In `DialogFooter`:

- **Delete the whole `artifact.shareUrl && …` Open share page block.** Nothing
  opens the public page in a new tab any more; the README records this as
  intended. Remove the `Launch` icon import and the `externalLinkProps` import
  if nothing else in the file uses them, or lint will fail.
- Add an always-present **Share** button before **Download** — private or
  public, `variant="outline"` with the `Share` icon from `@carbon/icons-react`
  and the label `Share`. It sets a local `sharing` boolean.

### 5. Stack the share dialog over the preview

Mount `<ShareDialog artifact={artifact} onClose={() => setSharing(false)} />`
when `sharing` is true, as a **sibling of `<Modal>`** inside the existing
fragment — the same shape `FullscreenPreviewDialog` already uses at the bottom
of the file, which is the in-repo precedent for stacking over this dialog.

Owning the dialog here rather than accepting an `onShare` prop is deliberate:
`ArtifactDialog` in `artifacts-view.tsx` is a single-dialog discriminated union
whose `preview` and `share` members are mutually exclusive, so routing through
the parents would mean reworking the state machine at every mount site to allow
two dialogs at once. Self-owned gets all three sites right and touches none of
them.

Closing the share dialog must leave the preview open — that is the user story.
Note that
[`share-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/share-dialog.tsx)
already self-closes when the user switches an artifact back to private; combined
with step 1 the preview then re-renders as private on its own. Do not modify
`share-dialog.tsx`.

### 6. Update the architecture page

[`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md),
the **UI surfaces** section.

Record the two facts that are now architectural rather than cosmetic, in the
page's existing prose style:

- The artifact's visibility badge is also the control that opens the sharing
  dialog, so state and control sit in one place. Artifacts rows therefore show
  their share actions at rest, unlike the other list surfaces, which keep
  actions behind a hover reveal.
- The in-app preview can start sharing directly, so opening an artifact is no
  longer a dead end for it.

`Last verified:` at the top of the page is already `2026-09-07`; refresh it if
the commit lands on a later date. Keep the edit short — the page describes
subsystems, not layouts. Follow
[documentation-guidelines.md](../../guidelines/documentation-guidelines.md) and
do not reference the issue or an ADR.

## Acceptance criteria

- [ ] The preview toolbar shows a `Public` or `Private` badge at its left, for
      every artifact.
- [ ] **Share** appears in the footer for both private and public artifacts.
- [ ] **Copy link** appears in the toolbar only when the artifact is public, and
      copies the share URL.
- [ ] **Open share page** is gone from the footer, and no unused imports remain.
- [ ] Clicking **Share** opens the share dialog **on top of** the preview;
      closing it leaves the preview open.
- [ ] Turning a private artifact public from inside the preview updates the
      badge to `Public` and makes **Copy link** appear, **without** the preview
      being closed and reopened.
- [ ] Turning a public artifact private from inside the preview updates the
      badge to `Private` and removes **Copy link**, with the preview still open.
- [ ] Source and Fullscreen still appear only for renderable kinds, and the
      version switcher still works.
- [ ] The Home feed's artifact chips and the sandbox home list open the same
      updated dialog, with no edits to those files.
- [ ] `docs/architecture/artifact-library.md` describes the badge-as-control and
      the preview's share entry point.
- [ ] `mise run ui:check`, `mise run ui:test` and
      `mise run common:check:comment-types` all pass.

## Smoke test

```bash
mise run ui:check ::: mise run ui:test ::: mise run common:check:comment-types
```

Then, by hand:

```bash
mise run ui:run
```

Open the URL Vite prints — confirm the port, because another worktree may
already own 5173. Log in, go to **Artifacts**, and click a **private** artifact
to open it. Confirm the toolbar shows `Private` at the left, that there is no
**Copy link**, and that **Share** sits in the footer next to **Download**. Click
**Share**: the dialog stacks over the preview. Enable the public link and Save,
then close the dialog — the preview must still be open, its badge must now read
`Public`, and **Copy link** must have appeared in the toolbar. Click **Copy
link** and paste the clipboard to confirm the URL. Click **Share** again, turn
the switch off and Save, and confirm the badge returns to `Private` and **Copy
link** disappears while the preview stays open. Check a non-renderable kind
(a `.doc`, say) still hides Source and Fullscreen. Finally open an artifact from
a Home feed session card's chip and confirm the same toolbar and footer.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
