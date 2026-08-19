# 02 — Feed filtering

**Depends on:** 01-home-shell-feed
**Part of:** A Home page — see [README](./README.md)

## Context

The feed from slice 01 renders everything it has. This slice adds the two controls above it: a status
filter, and the ability to include or exclude sources. Both are UI-local selections over the list the
feed already holds — no new query, no server round-trip on a filter change.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. The controls — `modules/home/components/feed-filter-bar.tsx`

Take the structure from the prototype's `FeedFilterBar` and `FeedFilterDropdown`. Two dropdowns:

- **Status** — *Everything*, *In progress*, *Unread*, *Needs attention*. These map onto the feed-item
  kinds slice 01 defined: in-progress is running work, unread is unread sessions, needs-attention is
  pending approvals, and *Everything* is the union. The mapping is one predicate per option over the
  discriminated union — put it in `modules/home/lib/feed-filter.ts`, not in the component.
- **Sources** — include or exclude schedules and channels. Multi-select, since the two are
  independent.

The prototype also draws a Time dropdown. **Leave it out.** The README settles that Home carries no
page-level time range; the only period control is inside the spend widget.

Reuse `@/components/ui/dropdown-menu` — do not build a bespoke dropdown. Check the prototype's version
against it and take the existing primitive if it fits, which it should.

### 2. Filter state

UI-local to Home, held in `home-view.tsx` and passed down. A `useState` per control is enough; do not
reach for a store, and do not persist to `sessionStorage` — a filter is not worth surviving a reload,
and the README fixes this lineage.

Default to *Everything* with all sources included.

### 3. Applying it

Filter in `modules/home/lib/feed-filter.ts` as a pure function from `(items, status, sources)` to
items, and call it in the view. Keep it out of the card components entirely.

Empty results need their own state per filter: "nothing in progress" reads differently from "nothing
needs your attention", and a user who filtered themselves into an empty list must be able to tell that
from a genuinely quiet system. Show the active filter in the empty message.

### 4. Stats readout

The status options carry no counts. The prototype puts a readout to the right of the control —
`N running · M to review` — counted over the **visible** feed, so it describes what you are looking at.
It hides when the feed is empty, because the empty state says it instead.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] Each status option shows only matching items; *Everything* shows the union.
- [ ] Excluding schedules or channels removes only those, and re-including restores them.
- [ ] Changing a filter fires no new network request.
- [ ] The status and source controls are one dropdown, as the prototype draws it — not two.
- [ ] The stats readout shows running and to-review counts over the visible feed.
- [ ] An empty result renders the empty-state card and names the active filter rather than implying the
      system is idle.
- [ ] There is no page-level time-range control anywhere on Home.
- [ ] The filter predicates are pure and live outside the components.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`, with one running sandbox, an unread session and a pending
approval:

1. Switch through *Everything*, *In progress*, *Unread* and *Needs attention* and confirm each shows
   only what it should, with the network panel quiet throughout.
2. Exclude schedules, then channels, then both; re-include them.
3. Filter to *Needs attention* with no approvals pending and confirm the empty message names the
   filter.
4. Confirm the counts beside the status options do not change as you switch between them.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
