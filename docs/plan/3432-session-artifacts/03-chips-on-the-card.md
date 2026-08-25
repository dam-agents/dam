# 03 — Chips on the feed card

**Depends on:** 01-touch-record
**Part of:** session artifacts on the Home feed cards — see [README](./README.md)

## Context

The last slice renders the touches. A Home feed card gains a chip per artifact the session produced
since the user last engaged with it, clicking through to the preview dialog that already exists.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. Read the touches

Add a query for slice 01's owner-facing read under
`packages/ui/src/modules/artifacts/api/` (or `modules/home/api/` if it is only ever the feed's
concern — the existing artifacts module is the better home if its keys are already there).

The feed knows which sessions it is rendering, so ask for those sessions in one call rather than one
call per card. Follow `modules/home/api/queries.ts` for how the feed composes its reads, and let the
touches ride the same invalidation the feed already receives rather than adding a timer.

Missing touches are not an error state: a card with no chips looks exactly like a card whose session
produced nothing. Do not surface a failure for this read — it decorates a card that is already
useful without it.

### 2. Filter to what is new

Show only touches newer than the card's session `seenAt` — the same signal
`modules/home/lib/unread.ts` already uses to decide the card is unread. A card the user has seen
carries no chips, and a card that returns after a dismissal because of unrelated activity carries
none either, since nothing was touched since.

Resolve each touch's artifact title from the artifact list rather than storing a copy — the id is
the only thing the touch carries by design.

### 3. Render

Put the chips on `modules/home/components/feed-card.tsx`, between the title block and the footer.
Match the prototype on `design/home-prototype`: a document icon and a truncated file name in a
bordered pill, the row reachable by clicking through to the artifact.

Cap the number shown and follow with a plain "+N more" — a session that wrote twenty files must not
make its card twenty chips tall. Clicking a chip opens the existing preview dialog
(`modules/artifacts/components/artifact-preview-dialog.tsx`); clicking anywhere else on the card
still opens the session, so stop the event on the chip.

Note the card already nests a `Dismiss` button inside a `role="button"` container — a known issue,
not this slice's to fix. Do not deepen it: keep the chips out of the nested-interactive problem by
following whatever pattern the fix eventually takes, and if that means the chips are the third
interactive thing in the card, say so in the report rather than quietly adding it.

### 4. Checks

`mise run ui:fix`, then `mise run ui:check`, `ui:test` and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] A card whose session produced an artifact since it was last seen shows a chip naming it.
- [ ] A card the user has already seen shows no chips.
- [ ] Clicking a chip opens the preview dialog and does not open the session.
- [ ] A session with more artifacts than the cap shows the cap plus a "+N more".
- [ ] A failed touch read leaves the card rendering normally, with no error state.
- [ ] One request covers every card on screen, not one per card.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`, with slices 01 and 02 deployed to the cluster:

1. From an agent's chat, ask it to publish an artifact, then go to Home.
2. Confirm the session's card carries a chip with the artifact's file name.
3. Click the chip and confirm the preview dialog opens and the session does not.
4. Open the session, return to Home, and confirm the chip is gone now the card is seen.
5. Narrow the window to mobile width and confirm the chips wrap rather than overflowing the card.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
