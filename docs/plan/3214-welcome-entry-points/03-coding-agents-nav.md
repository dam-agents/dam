# 03 — Coding agents page and updated left navigation

**Depends on:** 02-welcome-empty-home
**Part of:** Welcome new users and let them choose how they enter — see [README](./README.md)

## Context

This slice folds in [#3233](https://github.com/dam-agents/dam/issues/3233) — the same prototype, the same first-run story, so it ships in this PR rather than on its own. Three changes: a dedicated **Coding agents** page and nav item, **Artifacts** moved to the bottom of the nav, and a nav that **expands to show labels**.

The nav item uses Carbon `ContainerSoftware`, the same icon slice 02 put on the "Create a coding agent" card, so the card and the destination read as one thing.

#3233 says "implement alongside #3234" (per-feature setup pages). #3234 is a larger, separate change and is **not** in this PR.

Apply the `/react-ui-engineering` skill. Run `mise run ui:fix` after editing.

## Decisions already taken

- **Home is untouched.** It keeps the sandbox list and the welcome hero exactly as slice 02 leaves them. The prototype's populated Home is a dashboard we do not have, and inventing one is out of scope.
- **Coding agents lists coding agents only** — no knowledge-base and no experiment sandboxes, since those have their own pages. Home continues to list everything, so nothing becomes unreachable.
- **Inbox moves to the bottom group** with Artifacts and Settings, keeping its pending-approvals badge.

## Implementation plan

### 1. Route — `packages/ui/src/modules/platform/lib/routes.ts`

Add `{ view: "coding-agents" }` to the `Route` union, parse `/coding-agents`, and return that path from `routeToPath`. Add `"coding-agents"` to the `ParameterlessView` union in `packages/ui/src/modules/platform/store/navigation.ts`.

`packages/ui/src/__tests__/unit/routes.test.ts` round-trips a fixture list of paths — add `/coding-agents` to it. That is completing an existing table, not writing a new test.

### 2. Share the list, don't copy it

`list-view.tsx` currently owns the row rendering **and** the stop/delete confirmation flows, and `knowledge-bases-list-view.tsx` has its own near-copy of the delete flow. Two pages rendering sandbox rows is the third occurrence, so extract rather than duplicate:

- A hook under `modules/agents/hooks/` holding the stop and delete confirmation flows that `list-view.tsx` has inline today (they call `fetchSchedulesForAgent`, `showConfirm`, then `suspend.stop` / `deleteAgent.mutate`).
- A component under `modules/agents/components/` that takes a list of agents plus the row plumbing from `useAgentRows` and renders the `AgentRow`s, including the `splitTemporarySandboxes` draw grouping. Both Home and the new page use it, so temporary invocation sandboxes keep folding into their driver on both.

Add an `isCodingAgent` predicate next to `isKnowledgeBase` and `isExperimentSandbox` in `modules/agents/utils/agent-kind.ts` — an agent with no `kind`.

### 3. The page — `packages/ui/src/modules/agents/views/coding-agents-view.tsx`

`PageHeader` titled "Coding agents", a create action that opens the wizard with no starting point, the shared list filtered by `isCodingAgent`, the `ListSkeleton` while loading, and a `PageEmptyState` when the user has none. Keep the empty-state copy short and consistent with the card's wording; the deeper empty-state copy pass is #3190's.

The create button reads "Create coding agent" on this page, matching its title. Everything else in the product still says sandbox — the entity rename is a separate terminology issue, so do not rename anything else.

Render it from `app.tsx` in the same container branch as the other list views. Home keeps the 1200px container from slice 02; this page takes the standard 960px.

### 4. Nav — `packages/ui/src/components/icon-rail.tsx`

- Main group, in order: Home, Coding agents, Experiments, Knowledge bases.
- Bottom group: Inbox, Artifacts, Settings.
- The mobile bottom bar grows from six items to seven. Verify it at a 375px-wide viewport and keep every destination reachable there.

### 5. Expandable nav

Collapsed is today's 56px icon rail; expanded shows labels beside the icons, as in the prototype's screenshots.

- The expanded/collapsed flag is shared UI state that must outlive a reload. Follow the precedent in `modules/platform/store/theme.ts` — a store slice that reads and writes `localStorage` — rather than inventing a second persistence style.
- The brand row carries the toggle: the prototype reveals it on hover and shows a close control while expanded. Keep the brand itself navigating Home, and give the toggle its own button with an accessible label and `aria-expanded`.
- Show the per-item `Tooltip` only while collapsed — beside a visible label it is noise.
- Keep `data-testid="app-sidebar"` on the nav; e2e specs use it.
- The prototype also toggles the nav when any empty space in the rail is clicked. Skip that: a large click target with no affordance is surprising and hostile to keyboard use. Note it in the PR as a deliberate deviation.

## Acceptance criteria

- [ ] `mise run ui:check`, `mise run ui:test`, and `mise run common:check:comment-types` pass.
- [ ] `/coding-agents` round-trips through `parseRoute` and `routeToPath`, and browser back/forward works across the new page.
- [ ] The page lists only agents with no kind; a knowledge base or experiment sandbox never appears there.
- [ ] Home is unchanged — same list, same hero, same width.
- [ ] Temporary invocation sandboxes fold into their driver row on both Home and the new page.
- [ ] Nav order matches the prototype, with Inbox, Artifacts and Settings grouped at the bottom and the badge still on Inbox.
- [ ] Expanding the nav shows labels; the state survives a reload; tooltips appear only while collapsed.
- [ ] The toggle is reachable by keyboard, states its expanded/collapsed condition to assistive tech, and every nav item stays operable in both states.
- [ ] All seven destinations remain usable on a 375px-wide viewport.
- [ ] No sandbox is renamed outside this page's title and its create button.

## Smoke test

```sh
mise run ui:check
mise run ui:test
```

Then in the Vite dev server at `localhost:5173`:

1. Open the nav toggle, reload, and confirm the nav comes back in the state you left it.
2. Visit Coding agents. Confirm it lists your plain sandboxes and neither the knowledge base nor an experiment sandbox.
3. Open a row, use browser back, and confirm you land back on `/coding-agents`.
4. Confirm Home still shows everything, unchanged.
5. Narrow the window to 375px and confirm every destination in the bottom bar is reachable.
6. Tab through the nav in both states and confirm focus is visible and the toggle announces itself.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
