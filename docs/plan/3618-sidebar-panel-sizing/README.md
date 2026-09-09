# Chat sidebar panel sizing

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3618

## Goal

A user sets how the chat sidebar splits its height between Sessions, Files and Artifacts, in
any combination of open and collapsed panels, and the choice survives a reload.

Today the column is one sized panel plus leftovers. Sessions holds a fixed pixel height clamped
to 600px, Files and Artifacts split whatever is left in equal halves, and the single divider
between Sessions and Files disappears when either of the two collapses. A user with Sessions
collapsed and Files plus Artifacts open has no control at all.

## Approach

Treat the column as one weighted stack instead of one fixed panel plus leftovers.

Each of the three panels carries a **weight**. Open panels lay out with
`flex-grow: <weight>; flex-basis: 0`, so the browser divides the free height in proportion to
the weights. A collapsed panel keeps today's `flex: 0 0 44px` header and takes no part in the
division. Weights persist, so collapsing a panel leaves its neighbours' relative proportions
untouched, and reopening it restores the share it had.

A **divider** sits immediately above every open panel that has an open panel above it,
**ignoring collapsed panels in between**. This is the rule that fixes the second bullet of the
issue: with Sessions open, Files collapsed and Artifacts open, the divider renders above the
Artifacts header and drags space between Sessions and Artifacts. Ignoring the collapsed panels
is what makes control independent of which panels happen to be open.

Dragging a divider moves height between exactly the two panels it separates and leaves the rest
alone. It preserves the pair's combined weight and re-splits it by the pair's new pixel ratio,
so an unrelated panel never jumps. The only limit is `MIN_PANEL_PX`: a drag stops when either
panel of the pair would fall below it. There is no maximum, so a panel grows until its
neighbours reach their minimum, which is what makes a tall display fully usable.

This is a client-only change inside `packages/ui`. There is no server side, no tRPC contract and
no architecture page — the chat sidebar's layout is not a documented subsystem, and none of the
pages under `docs/architecture/` describe it.

### Layout state today

| Concern | Where it lives now |
|---|---|
| Sessions height | `sessionsH` local state in [`chat-view.tsx`](../../../packages/ui/src/modules/sessions/views/chat-view.tsx), key `platform-sessions-h` |
| Flex rule | `sectionFlex()` helper in the same file |
| Drag suppression of the CSS transition | `resizingSections` local state in the same file |
| Open/collapsed flags | three separate store slices: [`sessions/store/sessions.ts`](../../../packages/ui/src/modules/sessions/store/sessions.ts), [`files/store.ts`](../../../packages/ui/src/modules/files/store.ts), [`artifacts/store.ts`](../../../packages/ui/src/modules/artifacts/store.ts) |

The open/collapsed flags stay exactly where they are. Only the sizing moves.

## Decisions

These settle the issue's Open Questions.

- **Reopening a panel restores its earlier share, and collapsing one holds the others'
  proportions.** Both fall out of one rule: weights are per-panel and persistent, and the
  layout normalises over the open ones only. No separate redistribution step exists.
- **Sizes are stored globally, in `localStorage`.** This matches the collapse flags and the
  sidebar width, which are already global, and matches the user story *I arrange the sidebar
  once*. A per-agent map would grow with every agent the user ever opens and would need pruning.
- **Storage is three number keys**, written with the existing `readPersistedNumber` /
  `writePersistedNumber` in [`persisted-prefs.ts`](../../../packages/ui/src/lib/persisted-prefs.ts).
  A single JSON blob would need parsing and validation code that three plain numbers do not.
- **The old `platform-sessions-h` value is dropped, not migrated.** It is a pixel height, and
  converting it to a weight needs the container height, which is unknown when preferences are
  read.

## Out of scope

- Keyboard and touch support for dividers. `ResizeHandle` is mouse-only across the whole app;
  changing that is a separate concern and the issue does not ask for it.
- The sidebar column's width and the file viewer beside the chat. Both already resize, and the
  issue puts them out of scope.
- Any change to which panels are open by default, or to the collapse flags' storage.

## Conventions & glossary

- **Panel** — one of the three stacked sections in the chat sidebar: Sessions, Files, Artifacts.
  Each renders through [`SidebarSection`](../../../packages/ui/src/modules/sessions/components/sidebar-section.tsx).
- **Weight** — a positive number per panel. Open panels divide the free height in proportion to
  their weights. Default is `1` for each, giving an even split on a fresh browser.
- **Divider** — a vertical [`ResizeHandle`](../../../packages/ui/src/components/resize-handle.tsx)
  between two open panels. It consumes no layout height: its `h-[5px]` is cancelled by
  `-mt-[3px] -mb-[2px]`.
- **`MIN_PANEL_PX` = 120** — the smallest height an open panel may be dragged to. It is today's
  lower clamp, kept unchanged.
- **`COLLAPSED_PX` = 44** — a collapsed panel's header height, `h-11`, unchanged.

Apply the `/react-ui-engineering` skill throughout. Follow
[`docs/guidelines/comment-guidelines.md`](../../guidelines/comment-guidelines.md) for any comment,
and run `mise run check:comment-types` after editing code. No server-side TypeScript is touched,
so `/typescript-engineering` does not apply.

## Whole-feature smoke test

Against the dev cluster at `http://localhost:4444`, open an agent's chat with all three panels
expanded, then:

1. Drag the Sessions/Files divider down. Sessions grows past 600px on a tall window; Artifacts
   does not move.
2. Drag the Files/Artifacts divider. A second divider exists and works.
3. Collapse Sessions. Files and Artifacts keep their previous 2:1 (or whatever) ratio, and the
   divider between them still drags.
4. Collapse Files with Sessions and Artifacts open. One divider renders above the Artifacts
   header and drags space between Sessions and Artifacts.
5. Reopen Sessions. It comes back at the share it had in step 1.
6. Reload the page. Every size is as it was left.
7. Drag any divider to its end stop. The shrinking panel stops at roughly 120px and neither
   panel collapses or overflows the column.

## Delivery

One sub-issue, one atomic commit. The feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3618.
