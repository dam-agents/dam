# 05 — Share dialog and badges

**Depends on:** 02-restricted-visibility-model
**Part of:** Share an artifact with a restricted group — see [README](./README.md)

## Context

The owner-facing side. The Share dialog moves from one switch to three choices and gains an
email list editor. The library badge learns "Restricted". Nothing here talks to the share host;
it only drives the `setSharing` contract pinned in slice 02.

## Implementation plan

Apply `/react-ui-engineering`. Reuse the primitives in `packages/ui/src/components/ui/`
(`radio-group.tsx`, `input.tsx`, `badge.tsx`, `button.tsx`); do not add a dependency for tag
input.

1. `packages/ui/src/modules/artifacts/components/share-dialog.tsx`:
   - Replace the `Public link` switch with a radio group of three options, in this order and
     with this copy: **Private** — "Only you, in the app." / **Restricted** — "Only people you
     name. They sign in with their company account." / **Public link** — "Anyone with the link.
     No account needed."
   - When Restricted is selected, show the viewer list editor under it: an input with
     placeholder `name@company.com`, Enter or a "+ Add" button appends; each entry renders as
     a removable chip; duplicates (after lowercase/trim) are ignored with no error; an invalid
     address shows an inline hint "Enter a full email address"; a counter appears at 40+ with
     the 50 cap. An empty list is allowed and shows the hint "Nobody is on the list yet. Only
     you can open the link until you add someone."
   - Show the share link row for both Restricted and Public link (the link is the same).
   - Local state: `{ visibility, viewers }` mirrored from the artifact; `unsaved` compares both
     against the committed values. Save calls `useSetArtifactSharing` with
     `{ id, visibility, viewers }` (send `viewers` only when visibility is Restricted or when
     the list changed, so switching to Public does not wipe the list).
   - Toasts: "Sharing updated — only the people on the list can open the link." for Restricted;
     keep the existing two.
2. `packages/ui/src/modules/artifacts/components/artifact-badges.tsx`: a third branch renders
   `<Badge variant="muted">Restricted</Badge>` (or the variant the file uses for public; pick
   the one that reads as "shared but limited" and keep it consistent with `version-badge.tsx`).
3. `packages/ui/src/modules/artifacts/components/artifact-row.tsx` `ShareLinkButton`: the copy
   link action must be available for Restricted too (it checks `shareUrl`, so likely already
   true; verify). Tooltip text for Restricted: "Copy link — opens only for people on the list".
4. Search the UI for `visibility === "public"` / `!== "public"` (`artifact-row-menu-items.tsx`,
   `folder-group.tsx`, `chat-artifacts-panel.tsx`, `sandbox-artifacts-section.tsx`,
   `docked-artifact-panel.tsx`, `lib/format.ts`) and decide each: "has a link" checks should
   become `shareUrl !== null`; "is public" checks that drive wording stay as they are.
5. Do not touch `retention-dialog.tsx`; retention is orthogonal.
6. `mise run ui:check` (tsc, lint, prettier) and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] The dialog shows three radio options; the current artifact state is preselected.
- [ ] Choosing Restricted reveals the list editor; adding `" Ana@Corp.com "` shows a chip
      `ana@corp.com`; adding it again does nothing; adding `ana@corp` shows the inline hint.
- [ ] Save with Restricted + two emails persists; reopening the dialog shows the same two.
- [ ] Switching Restricted → Public link → Restricted without saving in between keeps the
      list in the dialog; after saving Public and reopening, choosing Restricted again shows
      the previously saved list (the server kept the rows).
- [ ] Library rows show a Restricted badge, and Copy link works for them.
- [ ] `mise run ui:check` passes; no new dependency in `packages/ui/package.json`.

## Smoke test

```
mise run ui:check
mise run cluster:build-ui
```

Hard-reload the Artifacts page (an open tab keeps the old bundle). Open Share on an artifact,
walk the acceptance list above by hand, then confirm from an agent chat that the artifact's
share state shows as Restricted when listed via the agent's tools (read-only), and that the
agent cannot change it.
