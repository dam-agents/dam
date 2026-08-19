# 09 — Retire `/inbox`

**Depends on:** 03-inline-approval-cards, 08-floating-approvals-pill
**Part of:** A Home page — see [README](./README.md)

## Context

With approvals in the feed (03) and reachable from every other page (08), `/inbox` has nothing left to
carry. This slice folds it into Home, moves its badge, and makes Home the landing route. Nothing here
is optional: leaving `/inbox` in place means two surfaces for the same decisions, and leaving the badge
on a retired destination points the user at a dead end.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. Home becomes the landing route

Slice 01 may have mounted Home beside the existing `list` view rather than at `/`. Settle it here:
`/` resolves to Home in `modules/platform/lib/routes.ts`, and the round-trip fixture in
`src/__tests__/unit/routes.test.ts` reflects it.

Decide what happens to `modules/agents/views/list-view.tsx`, today's Home — the sandbox inventory with
the budget meter and the sandbox list. Home's compute widget (05) supersedes the meter, and the sandbox
list has its own destinations now (Coding agents, Experiments, Knowledge bases). Either keep it on a
route of its own or delete it; grep for every entry point first, and if you delete it, take
`welcome-entry-points.tsx` with care — slice 01 reuses it for Home's zero-sandbox state.

### 2. Retire the route

Keep `/inbox` resolving — it is in browser histories — and map it to Home in `parseRoute`, so
`routeToPath` never emits it again. The round-trip fixture asserts identity, so `/inbox` moves to the
non-round-trip assertions beside the other legacy-path cases.

Remove `inbox` from the `ParameterlessView` union in `modules/platform/store/navigation.ts` and its
branch in `app.tsx`.

### 3. Delete the view

`modules/approvals/views/inbox-view.tsx` goes. Keep everything the feed and the pill compose:
`components/approvals-list.tsx` (grep first — slice 07's modal or slice 03 may now be its only caller,
and if nothing uses it, delete it too), `api/queries.ts`, `api/mutations.ts`, `lib/hold.ts`,
`lib/egress-approval-restart.ts`, and the egress toasts.

### 4. Move the badge

`components/icon-rail.tsx` renders the pending-approval count on the Inbox destination via
`useApprovalsForOwner`. Move that badge to the Home destination and remove the Inbox entry from both
the rail and the mobile bottom bar.

### 5. Copy sweep

Two files name the inbox in user-facing text:

- `modules/approvals/lib/egress-approval-restart.ts`
- `modules/egress-rules/components/agent-egress-editor.tsx`

Both tell the user where to go to approve something. Reword for where approvals now live. Then grep
`packages/ui` and `docs/` for "inbox" and fix anything else that describes a surface that no longer
exists.

### 6. The e2e spec

`packages/e2e/playwright/src/tests/smoke/11-egress-path-rules.spec.ts` drives `/inbox` to approve an
egress request. Rewrite that step against Home's feed — or the pill, if that is what the spec's flow
naturally reaches. Do not weaken it into something that passes without approving anything.

Run `mise run --force e2e-playwright:check` after editing. The suite itself needs a cluster
(`mise run e2e`); if you cannot run it, say so plainly rather than implying it passed.

### 7. Architecture docs

Home replacing the inbox as the landing surface is a behavioral change to a described subsystem. Check
`docs/architecture/` for pages describing the inbox or the landing route and update them, bumping
`Last verified:`. Follow `docs/guidelines/documentation-guidelines.md`, and mind the per-page size cap
— state what the system does now rather than narrating what changed.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test`, `--force e2e-playwright:check`,
      `--force docs:check` and `--force common:check:comment-types` pass.
- [ ] `mise run --force test` passes.
- [ ] `/` lands on Home; `/inbox` resolves to Home and `routeToPath` never emits it.
- [ ] No file imports the deleted view; nothing the feed or pill needs was deleted with it.
- [ ] The pending count sits on Home in both the rail and the mobile bar, and Inbox appears in neither.
- [ ] `grep -ri inbox packages/ui docs` returns nothing describing a current surface.
- [ ] The e2e spec approves a real egress request through the new surface.
- [ ] Architecture pages describing the landing surface match the code, with dates bumped.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
mise run --force e2e-playwright:check
mise run --force docs:check
mise run --force test
```

Then on the dev server at `localhost:5173`:

1. Sign in and confirm you land on Home.
2. Visit `/inbox` and confirm it lands on Home.
3. Confirm the rail shows the pending count on Home and has no Inbox entry, on both wide and mobile
   widths.
4. Trigger an egress approval and approve it from the feed; confirm the agent proceeds.
5. Confirm no route or button anywhere still opens the old inbox.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
