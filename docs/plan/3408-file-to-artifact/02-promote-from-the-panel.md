# 02 — Promote from the file panel

**Depends on:** 01-source-link
**Part of:** file to artifact — see [README](./README.md)

## Context

The user-facing half: a file open in the chat dock gains the promote button, and promoting
lands the user in the artifact view with sharing in reach. This slice also unifies the two
docks' toolbar typography, which drifted (the artifact panel runs smaller/heavier than the
file panel and the designs).

Apply the `/react-ui-engineering` skill.

## Implementation plan

1. **Find the linked artifact.** The chat surface already fetches the agent's artifacts
   (`useArtifacts` filtered by agent — see `chat-artifacts-panel.tsx`). Given the open file's
   path, the linked artifact is the `sourcePath === path` match with the newest `updatedAt`
   (README: most-recent wins, no disambiguation). A small hook in
   `packages/ui/src/modules/files/` or `modules/artifacts/` returning
   `{ linked: LibraryArtifact | null }`.
2. **The button** in the docked file toolbar
   (`packages/ui/src/modules/files/components/docked-file-panel.tsx` /
   `file-viewer.tsx` — the toolbar with Edit/Download): per DAM.png it sits left of Download
   with the create-artifact glyph. Label **"Create artifact"** with no linked artifact,
   **"Sync to artifact"** with one. Disabled with a tooltip when the panel's content is
   binary or `tooLarge` (the panel already knows — `FileContent.binary`/`tooLarge`).
3. **Promote.** First press: `artifactLibrary.create` with the panel's content, the file's
   basename as `fileName`/title, `sourcePath` = the file's path; content past the inline cap
   goes through the existing staging-upload (`createUploadUrl` + `uploadRef`) the upload dialog
   uses. Sync press: `artifactLibrary.update` with content + `sourcePath` only — title,
   visibility and folder are the artifact's own (README semantics).
4. **Land in the artifact view.** On success, the dock switches from the file panel to the
   docked artifact panel (`setOpenArtifactId` — the chat surface already renders
   `docked-artifact-panel.tsx`), where the primary action is **Share** when private and
   **Copy link** when public, which that panel already decides (DAM-2 vs DAM-1). Invalidate
   the artifact list so the sidebar row appears without a refresh.
5. **Toolbar unification.** The designs and the file toolbar set the target: 14px / weight
   400 — Button `sm`, not `xs`. Bring `docked-artifact-panel.tsx`'s toolbar buttons (Share /
   Copy link, download, and kebab-adjacent controls) to the same variant and icon size as the
   file toolbar's, verifying against the running UI rather than trusting the greps: the drift
   the author saw may sit in one panel's overrides.
6. `mise run ui:fix`, then the checks below.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types`
      pass.
- [ ] A text file with no linked artifact shows "Create artifact"; pressing it creates the
      artifact with `sourcePath` set and the dock switches to the artifact view.
- [ ] Reopening the same file shows "Sync to artifact"; pressing it publishes a new version —
      same artifact id, same share link — and the artifact's title survives a prior rename.
- [ ] A binary or too-large file shows the button disabled with a reason.
- [ ] The artifact panel's toolbar text renders at 14px weight 400, matching the file panel's.

## Smoke test

```sh
mise run --force ui:check && mise run --force ui:test
```

Then on the dev server against a cluster with slice 01 deployed: run the whole-feature smoke
test's first half (promote → Share → sidebar row appears → sync → v2). Compare both docks'
toolbars side by side at the same zoom.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
