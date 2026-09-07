# 04 — Version history with author and time

**Depends on:** 01-version-authorship-and-stale-save-guard, 02-editable-source-view-and-preview-dialog
**Part of:** A user can change the text of an artifact they own — see [README](./README.md)

## Context

This is the issue's second half: making the resulting version legible. Today
`VersionSwitcher` says only `v3 / 5` — two arrows and a count. Once an owner can
write versions, the question a reader actually has is *which of these did I write,
and when*. Sub-issue 01 records the author and `ArtifactVersionInfo` already
carried `createdAt` and `sizeBytes`; nothing displays any of it. This slice does.

Apply the [`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md)
skill.

## Implementation plan

### 1. The version list

New file `packages/ui/src/modules/artifacts/components/version-list.tsx`.

Take the artifact, the loaded `ArtifactVersionInfo[]`, the shown version and an
`onChange`. Render newest first, one row per version: the version number, when it
was written via [`timeAgo`](../../../packages/ui/src/lib/format-time.ts) with the
absolute time as the `title`, the size via `formatBytes`, and the author. Mark the
shown version, and mark the head. Clicking a row selects that version.

Author copy, and nothing more elaborate:

- `user` → "You". The library is owner-scoped, so the owner is the only person who
  can have written it.
- `agent` → the agent's display name from
  [`useAgentDisplayName`](../../../packages/ui/src/modules/agents/api/queries.ts)
  using the artifact's `agentId`, falling back to "Agent" when that is null.
- `null` → render no author at all. It means the version predates authorship
  tracking, and "Unknown" would claim more than the data says.

### 2. Reachable from the switcher

Turn the `v3 / 5` label in
[`version-switcher.tsx`](../../../packages/ui/src/modules/artifacts/components/version-switcher.tsx)
into a `Popover` trigger ([`popover.tsx`](../../../packages/ui/src/components/ui/popover.tsx))
that opens the list. Keep the two stepper arrows — they are the fast path and both
preview surfaces already rely on them.

The switcher does not fetch. Both call sites already hold the versions array from
`useArtifactVersions`, so pass it down rather than querying again inside the
switcher. Note the dialog currently only fetches versions when
`artifact.version > 1`
([`artifact-preview-dialog.tsx:41`](../../../packages/ui/src/modules/artifacts/components/artifact-preview-dialog.tsx));
that stays correct, since a single-version artifact has no history worth opening
and the switcher hides itself below two versions.

### 3. Both surfaces

Pass the versions array from
[`artifact-preview-dialog.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-preview-dialog.tsx)
and [`docked-artifact-panel.tsx`](../../../packages/ui/src/modules/artifacts/components/docked-artifact-panel.tsx)
into the switcher. The docked panel maps a selection to `pinnedVersion`, clearing
the pin when the head is chosen — the behaviour its stepper already has.

While a draft is dirty the switcher is hidden (sub-issues 02 and 03), so the list
cannot move the shown version out from under an open editor.

### 4. Documentation

Update the UI-surfaces section of
[`docs/architecture/artifact-library.md`](../../architecture/artifact-library.md):
the in-app previews let the owner change a text artifact's content, which publishes
a version, and the version history is readable — each version says when it was
written and by whom. Keep it at the level of the surface, not the components. Bump
`Last verified:`.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass, and
      `mise run common:check:comment-types` passes.
- [ ] An artifact with several versions opens a list from the version indicator, in
      both the preview dialog and the docked panel.
- [ ] Each row shows the version, a relative time with the absolute time on hover,
      and the size.
- [ ] A version the owner wrote reads "You"; one an agent published reads the
      agent's name; one from before the migration shows no author.
- [ ] Selecting a row changes the shown version in both surfaces, and selecting the
      head clears the pin in the docked panel.
- [ ] An artifact with one version shows no switcher and no list.
- [ ] The list is unreachable while an editor has unsaved changes.

## Smoke test

```bash
mise run check ::: mise run test
```

Then, on the dev cluster at `http://localhost:4444` (see the
[`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md) skill):

1. Take an artifact an agent published before this branch, have the agent publish
   one more version, then edit it yourself and save. It now has one pre-migration
   version, one agent version and one of yours.
2. Open the version indicator. Three rows: the oldest with no author, the middle
   naming the agent, the newest reading "You". Hover a time to see the exact
   timestamp.
3. Click the oldest row. The preview shows that version's text and **Edit** is gone.
   Click the newest row. **Edit** returns.
4. Repeat in the chat docked panel.
5. Open a single-version artifact. No version indicator appears.

The implementing agent runs this itself, then prints a short manual smoke-test
guide so the user can confirm it by hand.
