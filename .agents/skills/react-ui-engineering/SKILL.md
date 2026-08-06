---
name: react-ui-engineering
description: 'Use this skill whenever writing, editing, reviewing, or refactoring TypeScript React code — components, custom hooks, state stores, forms, queries, mutations, API clients, or styling. Trigger it for any task touching a `.ts` or `.tsx` file in a React project, including when the user says "add a feature", "fix this bug", or "clean this up" inside a component or hook. Also use it for architectural questions about React codebases: where state should live, whether a component is too big, how to organize modules, when to reach for TanStack Query, Zustand, React Context, or React Hook Form.'
---

# React + TypeScript UI Engineering

Opinionated standards for React+TS UI code. When a rule doesn't fit, say so and propose a deviation rather than silently ignoring it.

## Core principles

1. **Clean code & DRY** — every component, hook, and function does one thing. When the same pattern appears three times, extract it.
2. **Separation by lineage** — state is classified by where its source of truth lives (server, UI, local, URL). Each has a designated home. Mixing lineages is the single biggest driver of drift.
3. **Small surface, small files** — a component or hook that can't be held in working memory is a bug report waiting to happen. Split along responsibilities.
4. **Meaningful names** — identifiers carry intent: `selectedAgentId` over `sel`, `hasUnsavedChanges` over `flag`, `useFilteredAgents` over `useData`. Naming is the cheapest documentation you can write.
5. **No unnecessary comments** — names and structure say *what*; a comment says *why*, and only when the reason isn't visible in the code (a subtle invariant, an external constraint, a workaround for a specific bug). One line is usually enough. If a rename or a restructure removes the need for the comment, do that instead.
6. **Types at boundaries, not assertions** — `any`, `as`, and untyped fetch responses are how large codebases rot. Prefer Zod inference and type guards.

## Severity tiers

Rules in the reference files are tagged **CRITICAL** (a violation is a bug, call it out), **HIGH** (strong default, deviate only with a written reason), or **MODERATE** (recommended, local judgment OK). Attend in that order when reviewing.

## The state lineage model (CRITICAL — read before writing any stateful code)

Every piece of state has a source of truth. Classify first, then pick the home.

| Lineage | Examples | Home |
|---|---|---|
| **Server owns it** — fetched from backend or persisted there | lists of agents, secrets, sessions, user profile, connector config | **TanStack Query** cache (via `@trpc/react-query` for tRPC, or typed fetchers for non-tRPC) |
| **UI owns it, shared across components** — app-wide UI state, preferences not yet persisted | theme, open dialog, selected agent id, toast queue, navigation collapsed | **Zustand** or **React Context** |
| **UI owns it, local to one component** — ephemeral | input focus, hover state, accordion expanded, form field value before submit | `useState` / `useRef` |
| **URL owns it** — bookmarkable, shareable, back-button should restore | current route, filters, selected tab, pagination, search query | URL params / path |

**Do not duplicate across lineages.** If the server owns a list, you do not also keep it in Zustand. If the URL owns the selected agent, you do not also track it in `useState`. Duplication is the root cause of stale-state bugs.

## When to consult what

Read only what the task needs. Don't pre-load these.

| Situation | Read |
|---|---|
| Deciding where a new file goes | `references/project-structure.md` |
| Writing or editing a large component | `references/components.md` |
| Extracting logic into a hook, or a hook feels bloated | `references/hooks.md` |
| Deciding where a piece of state lives | `references/state-management.md` |
| Anything that talks to the server | `references/async-data.md` |
| Building a form | `references/forms.md` |
| Styling, inline styles, class composition, reusing an existing component | `references/styling.md` |
| API / fetch / tRPC setup and error handling | `references/api-layer.md` |
| Typing a prop, a response, an error, or defining constants / union literals | `references/types.md` |

## Legacy code migration

These rules are the target state, not a description of the existing codebase.

- **New code follows them, no exceptions.**
- **Touch-it = migrate-it.** Editing a 600-line dialog is the moment to split it. Adding a field to a `useState` form that has outgrown the RHF threshold is the moment to convert it. Don't bolt new code onto drift.
- **Batch migrations are a separate PR.** Moving a whole folder to `modules/{domain}/` or rewriting a god-hook doesn't ride along with feature work.
