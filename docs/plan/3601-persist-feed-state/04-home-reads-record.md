# 04 — Home reads one query

**Depends on:** 03-session-watcher
**Part of:** Persist activity feed state reliably — see [README](./README.md)

## Context

Home currently opens a passive ACP connection to every running agent and asks each for its
session list, then keeps them fresh through a dedicated owner-wide subscription. With the record
written, all of that becomes one owner-scoped query plus the standard hint — and hibernated
agents appear for the first time. Apply `/react-ui-engineering`.

## Implementation plan

1. **The query.** Add `useAttention()` to `packages/ui/src/modules/home/api/queries.ts` calling
   `attention.listForOwner`, keyed under the home key factory. It replaces the `useQueries`
   fan-out over `listAgentSessionsOverAcp` — delete that fan-out and the `homeKeys.sessions(...)`
   family with it. Leave `listAgentSessionsOverAcp` itself in
   `packages/ui/src/modules/sessions/api/acp-session-ops.ts`; the sessions module still uses it.

2. **Building items.** In `packages/ui/src/modules/home/lib/feed-item.ts`, build the `unread` and
   `in-progress` cases from `AttentionItem` instead of `SessionView`. Two rules change:
   - in-progress is `item.working && agent is currently running`, the agent state coming from the
     agents list the view already holds. A pod that died leaves no phantom work because its agent
     is no longer running.
   - the item's `at` is `activityAt ?? createdAt`.

   Keep the union's shape and the synthetic id format so `feed-list.tsx`, `feed-card.tsx` and the
   filter bar need no rework.

3. **Unread.** `packages/ui/src/modules/home/lib/unread.ts` keeps its rule — activity later than
   the seen mark — reading `activityAt` and `seenAt` off the attention item. Keep the terminal
   exclusion here; sub-issue 06 removes it deliberately, and mixing the two would make this slice
   unreviewable.

4. **Liveness.** Delete `packages/ui/src/modules/home/hooks/use-pod-sessions-watch.ts` and its
   mount in `views/home-view.tsx`. The `attention` invalidation entry added in sub-issue 03
   already refreshes the feed from the single `events.owner` subscription the app mounts once.

5. **Retire the owner-wide pod subscription.** Nothing subscribes to it now, so remove it whole:
   - `podSessions` from `packages/api-server-api/src/modules/events/router.ts`, its notice schema
     in `schemas.ts`, its type in `types.ts`, and `podSessions` from
     `packages/api-server-api/src/context.ts`;
   - `packages/api-server/src/modules/live-events/services/pod-sessions-service.ts` and its
     composition in `modules/live-events/compose.ts`;
   - the wiring in `packages/api-server/src/bootstrap.ts`,
     `packages/api-server/src/apps/api-server/deps.ts` and
     `apps/api-server/trpc/context.ts`.

   Grep for `podSessions` afterwards: only the pod's own `sessions.watch` (a different surface,
   used by the chat view and now by our watcher) may remain.

6. **Artifact chips.** `useFeedArtifacts` keys on agent id and session ids, both of which the
   attention item carries; point it at the new items and leave its cap alone.

7. **Empty and loading states.** The feed no longer waits on N agent queries, so the skeleton
   condition is one query's loading state. Check `home-view.tsx`'s "no agents" branch still wins
   over an empty feed.

## Acceptance criteria

- [ ] A session from a **hibernated** agent appears on Home, with its title and time.
- [ ] The network panel shows no per-agent ACP session connections from Home, and one
      `attention.listForOwner` read.
- [ ] A turn on a running agent updates Home live, over `events.owner`.
- [ ] A running session shows as working; hibernating the agent mid-session clears the working
      state rather than leaving it spinning.
- [ ] The status filters, source filters, artifact chips and the counts line all still work.
- [ ] `podSessions` appears nowhere in the codebase.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

With the dev cluster up and the UI on the Vite dev server (`mise run //packages/ui:run`):

1. Let a scheduled run finish, hibernate the agent, and open Home — the session is listed, which
   it never was before.
2. Wake another agent and drive a turn: the card appears and turns to working, then settles, with
   the network panel showing no per-agent session reads.
3. Hard-delete a running agent's pod and confirm its in-progress card stops claiming work.
