---
name: react-ui-engineering
description: 'Use this skill whenever writing, editing, reviewing, or refactoring TypeScript React code — components, custom hooks, state stores, forms, queries, mutations, API clients, or styling. Trigger it for any task touching a `.ts` or `.tsx` file in a React project, including when the user says "add a feature", "fix this bug", or "clean this up" inside a component or hook. Also use it for architectural questions about React codebases: where state should live, whether a component is too big, how to organize modules, when to reach for TanStack Query, Zustand, React Context, or React Hook Form.'
---

# React + TypeScript UI Engineering

When a rule doesn't fit, say so and propose a deviation instead of silently ignoring it.

## Core principles

1. **One job each.** Every component, hook and function does one thing; extract a pattern on its third appearance.
2. **Separation by lineage.** State is classified by where its source of truth lives (server, UI, local, URL), each with one home. Mixing lineages is the biggest driver of drift.
3. **Small files.** A component or hook too big to hold in working memory is a future bug; split along responsibilities.
4. **No prose comments**: follow `docs/guidelines/comment-guidelines.md`. Names, types and structure carry the *why*; only typed comments and tool directives survive `check:comment-types`.
5. **Types at boundaries, not assertions.** `any`, `as` and untyped fetch responses rot codebases; prefer Zod inference and type guards.

## Severity tiers

Reference rules are tagged **CRITICAL** (violation is a bug; call it out), **HIGH** (strong default; deviate only with a written reason) or **MODERATE** (recommended; local judgment OK). Review in that order.

## The state lineage model (CRITICAL: read before writing stateful code)

Classify first, then pick the home.

| Lineage | Examples | Home |
|---|---|---|
| **Server owns it** (fetched or persisted there) | agents, secrets, sessions, user profile, connector config | **TanStack Query** cache (via `@trpc/tanstack-react-query` for tRPC, typed fetchers otherwise) |
| **UI, shared** (app-wide, not yet persisted) | theme, open dialog, selected agent id, toast queue, nav collapsed | **Zustand** or **React Context** |
| **UI, local** (ephemeral) | focus, hover, accordion expanded, unsubmitted field value | `useState` / `useRef` |
| **URL** (bookmarkable, back button restores) | route, filters, selected tab, pagination, search query | URL params / path |

**Never duplicate across lineages**: a server-owned list isn't also in Zustand; a URL-owned selection isn't also in `useState`. Duplication is the root of stale-state bugs.

## When to consult what

Read only what the task needs.

| Situation | Read |
|---|---|
| Where a new file goes | `references/project-structure.md` |
| Writing or editing a large component | `references/components.md` |
| Extracting a hook, or a hook feels bloated | `references/hooks.md` |
| Where a piece of state lives | `references/state-management.md` |
| Anything talking to the server | `references/async-data.md` |
| Building a form | `references/forms.md` |
| Styling, inline styles, class composition, reusing a component | `references/styling.md` |
| API / fetch / tRPC setup and error handling | `references/api-layer.md` |
| Typing props, responses, errors; constants and union literals | `references/types.md` |

## Legacy code

These rules are the target state, not a description of the codebase.

- **New code follows them, no exceptions.**
- **Touch-it = migrate-it.** Editing a 600-line dialog is when to split it; adding a field to a `useState` form past the RHF threshold is when to convert it. Don't bolt new code onto drift.
- **Batch migrations are a separate PR** (moving a folder to `modules/{domain}/`, rewriting a god-hook).
