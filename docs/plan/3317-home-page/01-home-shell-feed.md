# 01 — Home module, two-column shell, feed spine

**Part of:** A Home page — see [README](./README.md)

## Context

This slice creates the `modules/home` module and puts the page on screen: the two-column layout, and
a feed carrying the three things the README fixes as its content — pending approvals, running
sessions, and unread sessions from running sandboxes. Filtering (02), the approval action set (03),
dismissal (04) and the right-hand widgets (05, 07) all land on top of this. Home already exists as
`modules/agents/views/list-view.tsx`; that view stays where it is for now and slice 09 decides what
happens to it.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. The module

Create `packages/ui/src/modules/home/` with `views/home-view.tsx`, `components/`, `lib/` and `api/`.
Do not copy the prototype's `modules/home` wholesale — it carries mock fixtures and a 1,910-line
view. Take component shapes from the prototype worktree, one at a time, as each is needed.

### 2. Feed data — `modules/home/api/queries.ts`

One hook, `useFeedItems()`, composing three sources into a single sorted list. Each source is a
separate query so a slow or failing one cannot blank the others:

- **Approvals.** `useApprovalsForOwner()` from `modules/approvals/api/queries.ts`, filtered to
  `status === "pending"`.
- **Running agents.** `useAgents()` filtered to `state === "running"`. This list bounds both sources
  below — never dial or query a hibernated agent.
- **In-progress work.** `agents.backgroundWork` per running agent (tRPC, `readAgentProcedure`, takes
  `{ id }`). Returns `SessionBackgroundWork[] | null`; `null` is a 404 and means "nothing to show",
  not an error to surface. It carries **no timestamp** — the shape is
  `{ sessionId, items: [{ id, description?, command? }] }` — so the feed takes the sort key from the
  session the work belongs to, joining `sessionId` against the ACP session list below. In-progress
  therefore depends on that dial too; it is not an ACP-free path.
- **Unread sessions.** `listAgentSessions(agentId)` from
  `modules/sessions/api/acp-session-ops.ts` per running agent — this is an ACP dial, so it is the
  expensive one. Unread is `Date.parse(updatedAt) > Date.parse(seenAt)`, exactly as
  `modules/sessions/components/sessions-sidebar.tsx` already derives it; extract that predicate into
  `modules/home/lib/unread.ts` and have the sidebar import it rather than duplicating the rule.

Model the per-agent fan-out with TanStack Query's `useQueries` so each agent's result caches and
retries independently. Give the ACP-backed query a longer `staleTime` than the tRPC ones — it is the
costly call — and keep `retry: false`, following `modules/metrics/api/queries.ts` which already treats
an unavailable backend as "render nothing" rather than an error.

### 3. Feed item shape — `modules/home/lib/feed-item.ts`

A discriminated union over the three kinds, each carrying the timestamp the feed sorts on and the
agent it belongs to. Sort keys: an approval's own `createdAt`; for unread and in-progress, the
session's `updatedAt`. An in-progress item whose session is missing from the ACP list has no sort key —
put it at the top rather than dropping it, since it is by definition happening now. Keep it a pure mapping from query results to items, with no React in the file, so
the ordering rule is testable without a renderer. Sort newest first; break ties on a stable id so the
list does not reshuffle between refetches.

### 4. The shell — `modules/home/views/home-view.tsx`

Two columns: the feed on the left, a widget column on the right that later slices fill. Reuse the
prototype's `FeedDashboardLayout` proportions and spacing. The right column is empty in this slice —
render nothing there rather than a placeholder.

Register the view: `home` in `modules/platform/lib/routes.ts` at `/`, the `ParameterlessView` union in
`modules/platform/store/navigation.ts`, the round-trip fixture in `src/__tests__/unit/routes.test.ts`,
and the render branch in `app.tsx`.

**Home takes `/` in this slice.** `/` resolves to the `list` view today; repoint it to Home now rather
than staging it behind a second route. Keep `list` reachable on a route of its own so nothing is
stranded and the sandbox inventory stays available — slice 09 decides whether it survives. Anything
that navigated to `list` as "go home" (`setView("list")` call sites, the rail's Home destination)
should now reach Home; grep for them and repoint.

### 5. Cards — `modules/home/components/`

One component per feed-item kind, each dumb: item in, click handler out. Approvals render a
non-interactive card in this slice — the action set is 03. Take the card structure from the
prototype's `BlockedCardsStacked` and `RunningSection`, and the read/unread treatment from `/compare`.

### 6. Empty and degraded states

- No sandboxes at all: Home explains itself rather than showing an empty feed. Reuse
  `modules/agents/components/welcome-entry-points.tsx`, which already does exactly this.
- Sandboxes exist but none running: the feed shows pending approvals only. Do not imply that nothing
  happened — say that unread and in-progress need a running sandbox.
- Nothing pending and nothing running: the cleared state from the prototype's state strip.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] Home renders the two-column shell with the feed populated from all three sources, newest first.
- [ ] No query touches an agent whose `state` is not `running`; hibernated sandboxes are never woken.
- [ ] A failing or slow ACP dial for one agent leaves the rest of the feed rendered.
- [ ] `null` from `backgroundWork` renders nothing and surfaces no error.
- [ ] The unread predicate lives in one place and `sessions-sidebar.tsx` uses it.
- [ ] With no sandboxes, Home shows the entry points rather than an empty feed.
- [ ] With sandboxes but none running, the feed still shows pending approvals.
- [ ] `/` resolves to Home, the route round-trips through `parseRoute`/`routeToPath`, and nothing that
      meant "go home" still lands on the old view.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`, signed in:

1. With one sandbox running and one hibernated, open Home. Confirm the feed shows the running
   sandbox's in-progress and unread items, and nothing from the hibernated one.
2. Confirm in the browser network panel that no request targets the hibernated agent.
3. Trigger an approval and confirm it appears in the feed (inert in this slice).
4. Hibernate everything and confirm the feed degrades to approvals only, with an honest message.
5. Delete every sandbox, or sign in as a fresh user, and confirm the entry points render.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
