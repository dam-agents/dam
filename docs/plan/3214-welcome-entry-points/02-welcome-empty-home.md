# 02 — Welcome the new user on the empty Home

**Depends on:** 01-record-entry-point-choice
**Part of:** Welcome new users and let them choose how they enter — see [README](./README.md)

## Context

This slice is the screen itself: a user who owns nothing opens Home and gets a short welcome plus three cards — a sandbox, an experiment, a knowledge base — each landing them in that creation flow and reporting the choice. It also deletes the first-run redirect that would otherwise send them past the screen without ever seeing it.

The design is `jamiejabbouribm`'s prototype screenshot on #3214 (first image). The value paragraph is `jenna-winkler`'s wording, approved on #3190.

Apply the `/react-ui-engineering` skill. Run `mise run ui:fix` after editing.

## Implementation plan

### 1. Mutation hook — `packages/ui/src/modules/usage/api/mutations.ts`

New file, following the idiom in `packages/ui/src/modules/experiments/api/mutations.ts`: `useRecordEntryPoint()` wrapping `trpc.usage.entryPointChosen.mutationOptions()`.

Nothing to invalidate, and **no `errorToast`** — a failed recording must stay silent. Confirm the shared mutation-cache handler stays quiet when `meta.errorToast` is absent; if it does not, silence it locally.

### 2. The hero — `packages/ui/src/modules/agents/components/welcome-entry-points.tsx`

New component, `WelcomeEntryPoints`, no props. Structure, following the prototype:

- A `Callout tone="muted"` as the container, with roomier padding than the default.
- An `h2` reading `Accelerate research with <brand>`, where the brand comes from `getBrand().name` — never a literal.
- The paragraph, verbatim: "Run agents in isolated cloud environments with credentials and tools securely injected. Create knowledge bases, run experiments to compare agent variants, and trigger agents from Slack or on a schedule." Constrain its width so it wraps like the design.
- A grid, one column on small screens and three from `md` up, holding the three cards.
- A right-aligned external link to `DOCS_URL` reading "Or check out the Documentation", with a Carbon `ArrowRight`. Use `externalLinkProps` from `@/lib/external-link`.

Each card is a local `EntryPointCard` built on `CardButton` (`@/components/ui/card-button`) so it inherits the card surface, hover, and focus ring: a Carbon icon, then the title, then the one-line description. Copy and destinations, in this order:

| Icon        | Title                    | Description                                                                          | Action                                       |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `Cube`      | Create a coding agent    | Work with your preferred coding agent, credentials, and tools in an isolated environment. | `navigateToCreateSandbox()`                  |
| `Chemistry` | Begin an experiment      | Run one goal across many variants at once and compare results.                       | `navigateToCreateSandbox("experiment")`      |
| `Book`      | Start a knowledge base   | Organize and converse with data sourced from repos, documents, and more (LLM wiki).   | `navigateToCreateSandbox("knowledge-base")`  |

The icons are the ones the wizard already uses for the same starting points in `packages/ui/src/modules/sandboxes/components/steps/starting-point-step.tsx`; `Chemistry` and `Book` are also the nav's icons for those destinations.

On click: start the recording, then navigate. Navigation is never awaited on the mutation, and a rejected mutation is swallowed.

### 3. Home — `packages/ui/src/modules/agents/views/list-view.tsx`

Replace the `PageEmptyState` block rendered when `initialLoaded && agents.length === 0` with `<WelcomeEntryPoints />`. Everything else in the view stays: the "Home" header, its `Create sandbox` action (already hidden while empty), the budget meter, the update banner, and the rows.

Drop the `PageEmptyState` import if nothing else in the file uses it.

### 4. First-run redirect

- Delete `packages/ui/src/modules/sandboxes/hooks/use-first-run-redirect.ts`.
- Remove its import and its call from `packages/ui/src/app.tsx`.

Those are the only two references in the codebase. The `platform-first-run-routed` session-storage key disappears with the hook; no cleanup is needed, as a stale key is simply never read.

## Acceptance criteria

- [ ] `mise run ui:check` and `mise run ui:test` pass.
- [ ] `mise run common:check:comment-types` passes.
- [ ] The heading renders the brand from `getBrand()`; no brand literal appears anywhere in the new code.
- [ ] A user with no agents sees the hero on Home, and is not redirected to the wizard on first load.
- [ ] A user with at least one agent sees the sandbox list, unchanged.
- [ ] Each card opens the wizard with the right starting point preselected.
- [ ] Clicking a card navigates immediately, and an api-server error surfaces no toast.
- [ ] Card and paragraph copy match the table above and the README character for character.
- [ ] The cards are reachable and operable by keyboard, with a visible focus ring.

## Smoke test

```sh
mise run ui:check
mise run ui:test
```

Then in the Vite dev server (`localhost:5173`), signed in as a user who owns nothing:

1. Load Home — the hero, three cards, and documentation link appear; there is no redirect to the wizard.
2. Click each card and confirm the wizard opens with the matching starting point, using browser back to return.
3. Confirm the network tab shows one `usage.entryPointChosen` call per click, and that a forced failure (offline, or blocking the request) leaves the UI silent and still navigating.
4. Create a sandbox, return to Home, and confirm the list replaces the hero.
5. Tab through the cards and confirm the focus ring and `Enter` activation.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
