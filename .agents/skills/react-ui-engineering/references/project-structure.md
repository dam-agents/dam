# Project structure

**Read when:** deciding where a new file goes, starting a new feature, refactoring folder layout.

## Top-level layout

```
src/
├── modules/             # Domain-oriented code (the bulk of the app)
│   └── {domain}/
│       ├── api/         # fetchers, query keys, mutations, types
│       ├── components/  # domain-specific UI
│       ├── hooks/       # domain-specific custom hooks
│       ├── contexts/    # domain-specific React contexts (if any)
│       └── types.ts     # (or types/ folder)
├── components/          # SHARED primitives (button, modal, input, icon)
├── hooks/               # SHARED hooks (useDebouncedCallback, useLocalStorage)
├── utils/               # pure functions, constants, helpers
├── lib/                 # integrations/adapters (auth client, logger)
├── store/               # Zustand slices (when used) — UI state only, not server state
├── contexts/            # app-wide contexts (theme, toast, modal service)
├── api/                 # root API clients (tRPC client, auth fetch, query client config)
├── styles/              # global CSS, tailwind config entry
└── app/ or main.tsx     # entrypoint, routing root
```

**[CRITICAL] Organize by domain, not by technical layer.** A feature-focused folder keeps change-locality high: adding a field to an agent touches `modules/agents/`, not six different directories. Layer-oriented layout (everything in `components/`, `dialogs/`, `views/`) inevitably scatters one feature across 4+ folders as the app grows.

## Domain module anatomy

Inside `src/modules/{domain}/`:

```
agents/
├── api/
│   ├── keys.ts              # query-key factory
│   ├── types.ts             # zod schemas + z.infer types
│   ├── index.ts             # pure fetchers (wraps tRPC/fetch)
│   ├── queries/
│   │   ├── use-list-agents.ts
│   │   └── use-agent.ts
│   └── mutations/
│       ├── use-create-agent.ts
│       └── use-delete-agent.ts
├── components/
│   ├── agent-list.tsx
│   ├── agent-card.tsx
│   └── agent-detail/        # nested when ≥ 10 sibling pieces
│       ├── index.tsx
│       ├── header.tsx
│       └── tools-list.tsx
├── hooks/
│   └── use-selected-agent.ts
└── types.ts                 # domain types not tied to API
```

**[HIGH]** Query keys and fetchers stay in `api/`. `queries/` and `mutations/` subfolders become optional when the module has fewer than ~5 of each — flat under `api/` is fine. Use nesting once it's earning its keep.

## Shared vs. domain

**Shared (`src/components/`, `src/hooks/`, `src/utils/`)** is for things that are truly generic and have no knowledge of any domain. A `Button`, a `useDebouncedCallback`, a `formatRelativeTime`.

**If in doubt, put it in the domain module.** Promotion to shared is a later step when you see the code used by 2+ modules. Premature promotion creates a vague "misc" pile.

**[HIGH] Don't hand-roll a generic, domain-agnostic primitive inline inside a feature file.** A `Switch`, `Toggle`, `Spinner`, `Badge` — anything in the same category as `Button`/`Input`/`Modal`, whose props are all generic (`checked`, `onCheckedChange`, `label`) and whose signature carries no domain types — does not belong defined in the middle of a 400-line form. That's the inline-primitive smell: pure styling + a11y wiring, reusable by construction, buried where no other feature can find it.

**Whether such a block is actually a shared-component candidate is a human judgment call — flag it, don't auto-promote.** When you spot one while editing, surface it ("this hand-rolled `Switch` looks like a generic primitive — extract to the shared primitives folder?") and let the user decide. Don't silently move it (premature promotion creates the "misc" pile above) and don't silently leave it. This is the one case where the "if in doubt, keep it local" default is overridden by escalation: the smell is mechanical to spot, but the promotion decision stays with a human.

## File naming

**[HIGH] Pick one convention per project and hold the line.** Two common choices:
- All lowercase kebab-case: `agent-card.tsx`, `use-mcp-picker.ts`, `agents.ts`.
- PascalCase for components, kebab-case for hooks/utils: `AgentCard.tsx`, `use-mcp-picker.ts`.

Either is fine; mixing them in one codebase isn't. Name matches file content — don't export `AgentCard` from `agent-list.tsx`.

Exceptions:
- `types.ts`, `index.ts`, `constants.ts` — conventional single-word filenames.
- Config files use their tool's expectation (`vite.config.ts`, `tsconfig.json`).

## Subcomponent file layout

**[MODERATE]** When a component grows sub-components, choose:

- **(a) Sibling files** when fewer than ~10 related children. They live next to the parent in `components/`, named with the parent's prefix.
  ```
  components/
  ├── agent-detail.tsx
  ├── agent-detail-header.tsx
  └── agent-detail-credits.tsx
  ```
- **(b) Nested folder** when 10+ children, or when the cluster has its own substructure (internal hooks, types, utilities).
  ```
  components/
  └── agent-detail/
      ├── index.tsx
      ├── header.tsx
      ├── credits.tsx
      ├── tools-list.tsx
      ├── tools-list-item.tsx
      └── utils.ts
  ```

Don't nest a folder with a single file in it. Don't leave 30 sibling files sharing a prefix.

## Barrel files (`index.ts`)

**[HIGH] No barrel files for component directories.** They're a re-export trap: they break tree-shaking in non-ideal bundler configs, create circular import hazards, and add maintenance for no consumer benefit. Import directly from the component's file.

**Exceptions (barrel OK):**
- `api/index.ts` — re-exports `queries/`, `mutations/`, `types`, `keys` as a single module surface.
- A React Context module: `contexts/app/index.ts` re-exports `useApp` to enforce the provider-only entry point.

## Imports

**[MODERATE]** Path aliases (`@/`, `#/`) are recommended for cross-module imports. Relative imports for sibling files. Don't introduce aliases mid-feature — if a project doesn't have them, propose adding them in a separate PR.

Use `./sibling` for intra-folder imports, `../parent` sparingly — if you're reaching `../../../` you're in the wrong folder.

## Migration from flat to domain layout

In a codebase that's organized by technical layer (`components/`, `dialogs/`, `views/`, flat `hooks/` and `store/`):

- **New features go into a module from day one.** Don't extend the old flat structure.
- **Touch-it = relocate-it.** When a feature change touches a cluster of files, move that cluster into its module in the same PR.
- **Large batch moves are their own PR.** Don't fold "move everything in `dialogs/` to `modules/secrets/components/`" into a feature change.
