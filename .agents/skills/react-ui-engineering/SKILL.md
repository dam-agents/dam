---
name: react-ui-engineering
description: 'Use this skill whenever writing, editing, reviewing, or refactoring TypeScript React code — components, custom hooks, state stores, forms, queries, mutations, API clients, or styling. Trigger it for any task touching a `.ts` or `.tsx` file in a React project, including when the user says "add a feature", "fix this bug", or "clean this up" inside a component or hook. Also use it for architectural questions about React codebases: where state should live, whether a component is too big, how to organize modules, when to reach for TanStack Query, Zustand, React Context, or React Hook Form.'
---

# React + TypeScript UI Engineering

This skill is the rulebook Claude applies when touching React+TS UI code. It is opinionated, with reasoning behind each rule. Treat it as a standards document: follow the rules, and when a rule doesn't fit, say so explicitly and propose a deviation rather than silently ignoring it.

---

## Core principles

1. **Clean code & DRY** — every component, hook, and function should do one thing. When the same pattern appears three times, extract it.
2. **Separation by lineage** — state is classified by where its source of truth lives (server, UI, local, URL). Each has a designated home. Mixing lineages is the single biggest driver of drift.
3. **Small surface, small files** — a component or hook that can't be held in working memory is a bug report waiting to happen. Split aggressively along responsibilities.
4. **Meaningful names** — variables, functions, components, hooks, and types carry intent in their names. `selectedAgentId` over `sel`; `hasUnsavedChanges` over `flag`; `calculateMonthlyTotal` over `calc`; `useFilteredAgents` over `useData`. A well-named identifier removes the need for a comment. Naming is the cheapest documentation you can write.
5. **No unnecessary comments** — code explains *what* through clear names and structure. Comments explain *why* only when the reason isn't obvious from the code itself: a subtle invariant, a non-obvious constraint, a workaround tied to a specific bug. Keep them brief — one line, usually. If you can rename a variable or restructure a block to remove the need for a comment, do that instead. Never narrate what the next line already says.
6. **Types at boundaries, not assertions** — `any`, `as`, and untyped fetch responses are how large codebases rot. Prefer Zod inference and type guards.

---

## Severity tiers

Every rule in the references is tagged with one of:

- **CRITICAL** — follow always; a violation is a bug. Call it out if you see it.
- **HIGH** — strong default; deviate only with a clear reason written down.
- **MODERATE** — recommended; local judgment OK.

Order of attention when reviewing: CRITICAL → HIGH → MODERATE.

---

## The state lineage model (CRITICAL — read before writing any stateful code)

Every piece of state has a source of truth. Classify first, then pick the home.

| Lineage | Examples | Home |
|---|---|---|
| **Server owns it** — data fetched from backend or persisted there | lists of agents, secrets, sessions, user profile, connector config | **TanStack Query** cache (via `@trpc/react-query` for tRPC, or typed fetchers for non-tRPC) |
| **UI owns it, shared across components** — app-wide UI state, user preferences not yet persisted | theme, open dialog, selected agent id, toast queue, navigation collapsed | **Zustand** or **React Context** |
| **UI owns it, local to one component** — ephemeral | input focus, hover state, accordion expanded, form field value before submit | `useState` / `useRef` |
| **URL owns it** — bookmarkable, shareable, back-button should restore | current route, filters, selected tab, pagination, search query | URL params / path |

**Do not duplicate across lineages.** If the server owns a list, you do not also keep it in Zustand. If the URL owns the selected agent, you do not also track it in `useState`. Duplication is the root cause of stale-state bugs.

See `references/state-management.md` for the detailed rules, Zustand slice conventions, and Context provider patterns.

---

## Top-level rules at a glance

Each of these is expanded in a reference file. Severity in brackets.

### Code style (applies everywhere)
- [HIGH] Names carry intent. Variables, functions, types, and components are named for what they represent, not for their type, position, or abbreviation (`selectedAgentId` not `sel`, `handleSubmit` not `h`, `Agent` not `Data`, `hasPendingChanges` not `dirty`). If you're reaching for a comment to explain a name, rename it.
- [HIGH] Comments explain *why*, not *what*. Add a brief comment only when code contains something a future reader couldn't infer: a subtle invariant, a workaround for a specific bug, a constraint from an external system. Delete comments that restate the code.
- [MODERATE] One line is enough for most comments. Multi-paragraph docstrings and block comments are almost always a sign that the code itself should be clearer.
- [MODERATE] Destructure when a path repeats in a scope. `schedule.status.lastRun`, `schedule.status.nextRun`, `schedule.status.lastResult` → `const { lastRun, nextRun, lastResult } = status;` (after the guard that narrows `status`). Single-use access stays inline — don't destructure for its own sake. See `references/components.md`.

### Structure & files
- [CRITICAL] Organize by **domain modules**, not technical layers. New code goes in `src/modules/{domain}/` with `api/`, `components/`, `hooks/`, `types.ts`. See `references/project-structure.md`.
- [HIGH] File naming: pick one convention for the project and stick with it. Don't mix `PascalCase.tsx` and `kebab-case.tsx` in the same codebase.
- [MODERATE] Subcomponent layout: **sibling files** when a parent has < 10 related children; **nested folder** (`parent-name/`) when more.
- [HIGH] A generic, domain-agnostic primitive (the `Button`/`Input`/`Switch` kind) doesn't belong hand-rolled inline in a feature file. When you spot one, **flag it for the user** — promoting it to the shared primitives folder is a human judgment call, not an automatic move. See `references/project-structure.md`.

### Components
- [CRITICAL] A component that does more than one thing is too big. Files approaching **~300 lines** are a strong trigger to split — not a hard cap, but a warning that responsibilities probably aren't separated. See `references/components.md`.
- [HIGH] **JSX weight** counts separately from file lines. Feature components ≤ ~60 lines of JSX; leaves ≤ ~25. Extract by region when the render block crosses that.
- [HIGH] Props typed with `interface Props` (or `type Props`) and destructured in the function signature. **No `React.FC<>`.**
- [HIGH] Anything non-trivial inside a `.map(...)` is its own component — >~10 lines of JSX, conditional branches, multi-statement handlers, or per-item derivations all qualify. Parent reads `{items.map((item) => <ItemCard … />)}` only.
- [CRITICAL] No static `style={{}}` — that's a Tailwind class or a CSS variable. Dynamic runtime values via CSS custom props are fine. See `references/styling.md`.

### Hooks
- [CRITICAL] Any `useEffect` that orchestrates multiple state pieces, or any component with more than ~5 `useState` calls, is a hook waiting to be extracted. See `references/hooks.md`.
- [HIGH] A hook doing more than one thing (a "god hook" with >5 `useState`/`useRef` or >3 `useEffect`) must be split. Orchestration goes in a thin parent hook that composes focused children.

### State management
- [CRITICAL] Server state lives in TanStack Query. **Never store a server list in Zustand.** See `references/state-management.md`.
- [HIGH] Export **selector hooks** per Zustand slice (`useSelectedAgentId`, `useToastActions`). Components should not call `useStore(s => ...)` inline.
- [HIGH] Split state and actions in selectors (`useAgents()` vs `useAgentActions()`) — actions rarely change identity and isolating them reduces re-renders.

### Async data (server state)
- [CRITICAL] Use TanStack Query via `@trpc/react-query` for tRPC procs, or typed fetchers + Zod for non-tRPC. No raw `fetch` in components. See `references/async-data.md`.
- [HIGH] **Query key factory** per domain (`agentKeys.list()`, `agentKeys.detail(id)`) — no string-literal keys.
- [HIGH] Mutations use **`meta.invalidates`** for cache invalidation and **`meta.errorToast`** for error surfacing. Centralize these in the QueryClient, not per-mutation.

### Forms
- [HIGH] Use React Hook Form + Zod when a form has **≥3 fields**, **cross-field validation**, **multi-step flow**, or **dirty-tracking needs**. Below that threshold, controlled `useState` is fine. See `references/forms.md`.
- [HIGH] A form schema is a Zod schema; the form values type is `z.infer<typeof schema>`.

### API layer
- [CRITICAL] Server calls are isolated from UI: fetchers live in `modules/{domain}/api/` and are wrapped by query/mutation hooks that UI imports. UI never calls `fetch`, `authFetch`, or tRPC procs directly. See `references/api-layer.md`.
- [HIGH] Non-tRPC responses are validated with Zod before consumption.

### Types
- [CRITICAL] No `any` at module boundaries. Use `unknown` + narrowing or proper types. See `references/types.md`.
- [HIGH] `as` only when a type guard cannot express the narrowing. When you must use `as`, a one-line comment explains why.
- [HIGH] Export types inferred from Zod schemas (`export type Agent = z.infer<typeof agentSchema>`) — single source of truth.

### Styling
- [HIGH] Tailwind for everything static. `cn()`/`clsx` for conditional classes. See `references/styling.md`.
- [CRITICAL] No static `style={{}}`. Dynamic CSS custom properties are fine (`style={{ '--width': `${pct}%` }}`).

---

## When to consult what

| Situation | Read |
|---|---|
| Deciding where a new file goes | `references/project-structure.md` |
| Writing or editing a component > ~200 lines | `references/components.md` |
| Extracting logic into a hook, or a hook feels bloated | `references/hooks.md` |
| Deciding where a piece of state lives | `references/state-management.md` |
| Anything that talks to the server | `references/async-data.md` |
| Building a form | `references/forms.md` |
| Styling decisions, inline styles, class composition | `references/styling.md` |
| API / fetch / tRPC setup and error handling | `references/api-layer.md` |
| Typing a prop, a response, or an error | `references/types.md` |

**Read only what you need.** These files progressive-disclose; don't pre-load all of them.

A project adopting this skill may keep a separate, time-boxed UI refactor plan (listing concrete legacy hotspots and fix recipes) in its own docs — e.g. `docs/plans/ui-refactor/`. That plan references this skill for rules and severity; the skill stays project-agnostic.

---

## Legacy code migration

The skill's rules are the target state. When editing an existing codebase that pre-dates them:

1. **New code follows all rules, no exceptions.** New modules go under `src/modules/{domain}/`. New fetches use TanStack Query. New forms use RHF + Zod when they clear the threshold.
2. **Touch-it = migrate-it.** If you're editing a 600-line dialog, that's the moment to split it per `references/components.md`. If you're adding a field to a `useState`-form that's grown past the RHF threshold, convert the form. Don't bolt new code onto drift.
3. **Batch migrations are a separate PR.** Moving an entire folder to `modules/{domain}/` or rewriting a god-hook into focused hooks is a dedicated refactor PR — don't mix with feature work.

If the project ships a UI refactor plan in its docs, prefer its recipes over ad-hoc rewrites.

---

## Future additions (tracked for later, not in scope for v1)

- **`/review` command** — analogous to `tomkis/typescript-engineering`: a walkthrough that audits a file or PR against this skill and produces an immutable review record.
- **`/bootstrap` command** — scaffold a new module (`modules/{domain}/` with boilerplate).
- **`/adopt` command** — guided migration of a legacy area (e.g., a dialog → RHF, a fetch → TQ).
- **Lint rules bundled** — `eslint-plugin-react-ui-engineering` codifying the CRITICAL rules so they fail CI instead of relying on Claude.

If a session would benefit from any of these, surface it; don't implement ad-hoc.

---

## How to apply this skill

1. When starting a task, classify what's being touched (component / hook / store / API / form / styling / types).
2. Open the relevant reference(s) from the table above. Skip what's not relevant.
3. Implement following the rules. When you deviate, say so and explain why in your response to the user.
4. Before reporting done, scan the change against the top-level rules in this file. If anything violates a CRITICAL rule, fix it or escalate.
