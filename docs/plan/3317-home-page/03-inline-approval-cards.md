# 03 — Inline approval cards

**Depends on:** 01-home-shell-feed
**Part of:** A Home page — see [README](./README.md)

## Context

Approvals appear in the feed after slice 01 but do nothing. This slice gives them their full action
set inline, so a user never leaves Home to unblock an agent. It is also the slice slice 08 reuses for
the floating pill, and the reason slice 09 can retire `/inbox`.

Apply the `/react-ui-engineering` skill. Egress approvals — rule match, hold, approval — are described
in [security-and-credentials](../../architecture/security-and-credentials.md); read that before
changing how one is actioned.

## Implementation plan

### 1. Read what exists first

`modules/approvals/` already owns this behavior for `/inbox`:
`views/inbox-view.tsx`, `components/approvals-list.tsx`, `api/mutations.ts`, `api/queries.ts`, and
`lib/hold.ts`. The mutations are `approveOnce`, `approvePermanent`, `approveHost`, `denyForever` and
`dismiss` (see `packages/api-server-api/src/modules/approvals/router.ts`). Do not reimplement any of
it — the card is a new presentation over the same mutations.

Read `lib/egress-approval-restart.ts` too: some approvals require an agent restart to take effect, and
that behavior must survive being moved into the feed. Its copy also mentions the inbox, which slice 09
fixes; leave the wording alone here.

### 2. The card — `modules/home/components/feed-approval-card.tsx`

Structure from the prototype's `FeedApprovalCard`. Every action the inbox offers, exposed on the card:
allow once, allow permanently, allow the whole host where the approval is an egress request, deny, and
dismiss. Which actions apply depends on the approval kind — take that logic from `approvals-list.tsx`
rather than re-deriving it, and extract it if it is currently inline in that component.

The card is presentational: it takes the approval and a set of handlers. Wiring mutations happens one
level up, so slice 08's pill can render the same card with the same handlers.

### 3. Resolved state — `modules/home/components/resolved-approval-card.tsx`

Structure from the prototype's `ResolvedApprovalCard`. When the user actions an approval, the card
becomes its resolved form in place rather than vanishing, so the click has visible consequence.

Be honest about what this is: the contract exposes **pending approvals only**, with no history query.
So the resolved card is a within-session affordance — it survives until the query refetches or the
page reloads, and then the approval is simply gone. Do not build anything that implies persisted
history, and do not add a client-side store to fake it.

### 4. Optimistic behavior and failure

Follow whatever `approvals-list.tsx` does today for pending state and errors — if it invalidates
rather than updating optimistically, do the same. A failed action must return the card to its
actionable state and surface the error; a card stuck in a resolved state after a failed mutation is
worse than no transition at all.

### 5. Live updates

`ApprovalRequested` and `ApprovalResolved` already flow through the live-events bus into query
invalidation (`modules/live-events/`). Confirm a new approval appears in the feed without a manual
refresh, and that one actioned elsewhere disappears. If it does not, the fix belongs in the
invalidation map, not in a Home-specific poll.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] Every action `/inbox` offers is available on the feed card, for the approval kinds it applies to.
- [ ] Actioning an approval from the feed has the same effect as actioning it on `/inbox`, restart
      behavior included.
- [ ] A resolved card shows its resolved state in place; a failed action returns it to actionable and
      shows why.
- [ ] The card component takes handlers rather than calling mutations itself, so slice 08 can reuse it.
- [ ] The action-applicability rule lives in one place, shared with `approvals-list.tsx`.
- [ ] A new approval appears, and a remotely-resolved one disappears, without a manual refresh.
- [ ] Nothing claims to show approval history.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`, with a running sandbox:

1. Trigger an egress approval. Confirm it appears on Home, allow it once, and confirm the agent
   proceeds and the card shows its resolved state.
2. Trigger another and deny it; confirm the agent's tool call fails cleanly.
3. Trigger one that needs a restart, allow permanently, and confirm the restart behavior still
   happens.
4. With Home open in two tabs, action an approval in one and confirm it disappears in the other.
5. Reload after resolving one and confirm the resolved card is simply gone — no fabricated history.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
