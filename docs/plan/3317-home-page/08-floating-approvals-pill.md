# 08 — Floating approvals pill

**Depends on:** 03-inline-approval-cards
**Part of:** A Home page — see [README](./README.md)

## Context

Approvals block agents, and a user is usually somewhere other than Home when one arrives. This slice
puts a floating pill on every non-Home page: it shows the pending count, expands into a mini panel of
approval cards, and disappears once nothing is pending. It is the last piece `/inbox` was carrying, so
slice 09 can retire the route once this exists.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. Start from the prototype's component

`components/floating-approvals-pill.tsx` on `design/home-prototype` is 342 lines and standalone — the
closest thing on that branch to reusable code. Take it as the starting point, then replace its fixture
data with the real query and its inline card markup with the card from slice 03.

### 2. Where it mounts

Mount once, high enough to appear on every page, in `app.tsx` beside the other always-present surfaces.
Do not mount it per view.

**Hide it on Home**, where the feed already shows the same approvals — two live surfaces for the same
decisions on one screen is worse than one. Derive that from the current view rather than from the
pathname.

Check what already floats before choosing a position and z-index: `modules/approvals/components/`
holds `egress-approval-toast.tsx` and `egress-approval-toasts.tsx`, and there is a toast system
(`@/components/ui/sonner`). The pill must not collide with either. If the existing egress toasts now
duplicate the pill's job, say so in your report — do not remove them in this slice.

### 3. Data and actions

`useApprovalsForOwner()` for the count and the list — the same query the feed uses, so the two stay
consistent by construction and share a cache entry.

Render slice 03's `feed-approval-card.tsx` inside the expanded panel with the same handlers. This is
why slice 03 keeps the card presentational; if the card cannot be reused here, that is a signal it took
on wiring it should not have.

### 4. Behavior

- Collapsed: a count. Expanded: the cards.
- Nothing pending: the pill is absent, not an empty pill.
- Actioning the last approval collapses and removes it.
- It must not trap focus or block the page underneath while collapsed, and it must be dismissible by
  keyboard when expanded.
- Live updates come from the existing invalidation, as in slice 03 — a new approval makes the pill
  appear without a refresh.

### 5. Small screens

The pill floats over content, so check it against the mobile layout: `app.tsx` renders a bottom bar on
small screens (`md:hidden` in `icon-rail.tsx`), and a floating pill sitting on top of it would be a
bug. Position clear of it or hide the pill on small screens, and note which you chose.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] The pill appears on every non-Home page when approvals are pending, and never on Home.
- [ ] It is absent, not empty, when nothing is pending.
- [ ] Expanding shows slice 03's card with its full action set, and actioning works from there.
- [ ] Actioning the last pending approval removes the pill.
- [ ] It does not collide with the existing egress toasts or the mobile bottom bar.
- [ ] Collapsed, it does not block interaction underneath; expanded, it can be closed by keyboard.
- [ ] A new approval makes it appear without a manual refresh.
- [ ] It is mounted once, not per view.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`, with a running sandbox:

1. Open a sandbox page, trigger an approval, and confirm the pill appears with a count of one.
2. Expand it, allow the approval, and confirm the agent proceeds and the pill disappears.
3. Trigger two approvals and confirm the count, then action them one at a time.
4. Go to Home and confirm the pill is absent while the feed shows the same approvals.
5. Narrow the window to mobile width and confirm the pill does not sit on the bottom bar.
6. Confirm the existing egress toast behavior is unchanged.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
