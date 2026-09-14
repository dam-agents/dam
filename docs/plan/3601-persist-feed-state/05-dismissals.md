# 05 — Dismissals that follow the user

**Depends on:** 04-home-reads-record
**Part of:** Persist activity feed state reliably — see [README](./README.md)

## Context

Dismissals live in `localStorage` under one key, capped at 300 entries, read by both Home and the
floating approvals pill. They cover two kinds of item: unread sessions and pending approvals.
This slice moves both to the per-user table, so hiding something on a laptop hides it on a phone.
Apply `/typescript-engineering` for the mutation and `/react-ui-engineering` for the UI.

## Implementation plan

1. **The mutation.** Add `dismiss` to `packages/api-server-api/src/modules/attention/router.ts`
   as an `operateAgentsProcedure` (dismissing is acting, not managing), input
   `{ kind: "session" | "approval", id: string }` validated in `schemas.ts`. The service writes
   `dismissedAt = now()` through `setDismissed`; the repository upserts on the composite key, so
   dismissing twice is idempotent.

   For a session, `id` is `` `${agentId}:${sessionId}` `` — the service checks the record exists
   and belongs to the caller's owner before writing, and treats a foreign row as not found. For an
   approval, `id` is the approval id, checked the same way against the approvals table.

2. **Emit nothing.** A dismissal is per user and changes only that user's view; the mutation
   returns and the client updates optimistically. No domain event, no hint — a hint would
   invalidate every tab of a user who has only one.

3. **The hiding rules live in one place.** Rewrite
   `packages/ui/src/modules/home/lib/dismissals.ts` from a localStorage store into pure
   predicates over the `dismissed` entries the query already returns:
   - a session item is hidden while `activityAt <= dismissedAt`, so new activity brings it back
     with no explicit un-dismiss — the behaviour the timestamped local keys imitated;
   - an approval is hidden once an entry exists.

   Delete the `MAX_KEYS` cap, `STORAGE_KEY`, and the read/write helpers.

4. **Drop the store slice.** Remove `DismissalsSlice` from
   `packages/ui/src/modules/home/store.ts` and the mixin on `PlatformStore`. Rewrite
   `hooks/use-dismissals.ts` to expose `dismiss(item)` backed by the mutation with an optimistic
   cache update on the attention query, and rollback on error.

5. **Both consumers.** Update `packages/ui/src/modules/home/views/home-view.tsx` and
   `packages/ui/src/components/floating-approvals-pill.tsx` to the new hook. The pill reads the
   attention query for its dismissal entries alongside the approvals query it already holds;
   the dismiss button behaviour and copy stay exactly as they are.

6. **`artifactsFor`.** `home-view.tsx` filters artifact chips added after a session's dismissal
   using the dismissal timestamp it used to parse out of the local key. That timestamp now comes
   straight off the `DismissedEntry`, which is simpler — keep the behaviour.

## Acceptance criteria

- [ ] Dismissing an unread session on Home hides it, and it is still hidden after a reload and in
      a different browser profile signed in as the same user.
- [ ] New activity on a dismissed session brings it back, with no explicit un-dismiss anywhere.
- [ ] Dismissing an approval on the floating pill hides it in both the pill and Home, across
      browsers, and the approval itself stays pending.
- [ ] Dismissing twice, or dismissing something another owner owns, does not error the page and
      writes nothing for the foreign row.
- [ ] `localStorage` holds no `platform-home-dismissed` key any more, and nothing in the UI reads
      one.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

Dev cluster, UI from the Vite dev server, two browser profiles signed in as the same user:

1. Dismiss an unread session in profile A; reload profile B — gone there too.
2. Drive one more turn on that session — it returns in both.
3. Dismiss a pending approval on the pill in A; check it is hidden in B and still pending in the
   session it came from.
4. Check `localStorage` in devtools: no dismissal key remains.
