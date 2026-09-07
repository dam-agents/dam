# 03 — The link glyph

**Depends on:** 01-source-link
**Part of:** file to artifact — see [README](./README.md)

## Context

The issue's legibility ask: the user should see which artifacts are connected to a workspace
file before sharing forces the discovery. Per DAM-1/2, a linked artifact's row in the chat
sidebar carries a small chain icon after the title.

Apply the `/react-ui-engineering` skill.

## Implementation plan

1. In the chat sidebar's Artifacts section
   (`packages/ui/src/modules/artifacts/components/chat-artifacts-panel.tsx`, and the row
   component it renders — follow to where the title truncates), render a chain icon
   (`Link` from `@carbon/icons-react`, 14px, muted) after the name when
   `artifact.sourcePath !== null`, `shrink-0` so a long title cannot push it out.
2. Tooltip on the icon: the source path (the stale-path caveat is by design — README).
3. The icon is decorative next to an already-labelled row: `aria-hidden`, with the tooltip
   carrying the text for pointer users; do not add it to the row's accessible name.
4. Check the row layout at a long title and a long path — the title truncates, the icon and
   the kebab stay.
5. `mise run ui:fix`, then the checks below.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types`
      pass.
- [ ] An artifact with `sourcePath` shows the chain icon; one without shows nothing new.
- [ ] Hovering the icon names the file path.
- [ ] A long artifact title truncates without displacing the icon or the row actions.

## Smoke test

```sh
mise run --force ui:check && mise run --force ui:test
```

Then on the dev server: with one promoted artifact (slice 02) and one plain upload in the same
agent, open the chat sidebar's Artifacts section — the promoted one carries the glyph with the
path on hover, the upload does not.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
