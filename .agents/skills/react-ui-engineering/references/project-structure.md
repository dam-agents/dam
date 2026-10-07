# Project structure

**Read when:** deciding where a file goes, starting a feature, refactoring folder layout.

## Top-level layout

```
src/
├── modules/{domain}/    domain code, the bulk of the app
│   ├── api/             fetchers, query keys, queries, mutations, schemas
│   ├── components/      domain UI
│   ├── hooks/           domain hooks
│   ├── contexts/        domain contexts (if any)
│   └── types.ts         (or types/)
├── components/          SHARED primitives (button, modal, input, icon)
├── hooks/               SHARED hooks (useDebouncedCallback, useLocalStorage)
├── lib/                 pure helpers and integrations (errors, toast, logger)
├── store/ or store.ts   Zustand (when used): UI state only, never server state
├── contexts/            app-wide contexts (theme, toast, modal service)
├── styles/              global CSS, Tailwind entry
├── api.ts, trpc.ts, auth.ts, query-client.ts   root clients
└── main.tsx             entrypoint, routing root
```

**[CRITICAL] Organize by domain, not technical layer.** Adding a field to an agent touches `modules/agents/`, not six directories; a layer layout (`components/`, `dialogs/`, `views/`) scatters each feature across 4+ folders as the app grows.

## Domain module anatomy

```
agents/
├── api/
│   ├── keys.ts              query-key factory (non-tRPC)
│   ├── schemas.ts           Zod schemas + z.infer types
│   ├── queries.ts           query hooks
│   └── mutations.ts         mutation hooks
├── components/
│   ├── agent-list.tsx
│   ├── agent-card.tsx
│   └── agent-detail/        nested at ≥ 10 sibling pieces
│       ├── index.tsx
│       ├── header.tsx
│       └── tools-list.tsx
├── hooks/
│   └── use-selected-agent.ts
└── types.ts                 domain types not tied to the API
```

**[HIGH]** Keys, fetchers and hooks stay in `api/`. Flat files are the default; split into `queries/` and `mutations/` folders (one hook per file) only once a module has ~5+ of each.

## Shared vs. domain

Shared folders hold only truly generic code with no domain knowledge (`Button`, `useDebouncedCallback`, `formatRelativeTime`). **When unsure, keep it in the domain module** and promote on the second module's use; premature promotion builds a vague "misc" pile.

**[HIGH] Don't hand-roll a generic primitive inline in a feature file.** A `Switch`, `Toggle`, `Spinner` or `Badge` (same category as `Button`/`Input`/`Modal`, all-generic props like `checked`, `onCheckedChange`, `label`, no domain types) buried in a 400-line form is pure styling + a11y wiring no other feature can find. Whether it should be shared is a human call: **flag it** ("this hand-rolled `Switch` looks like a generic primitive — extract to shared primitives?") and let the user decide; neither move it silently nor leave it silently. This overrides "keep it local" with escalation.

## File naming

**[HIGH] One convention per project**: all kebab-case (`agent-card.tsx`, `use-mcp-picker.ts`), or PascalCase components with kebab-case hooks/utils. Never mixed. The file name matches its content (no `AgentCard` exported from `agent-list.tsx`). Exceptions: `types.ts`, `index.ts`, `constants.ts`, and tool configs (`vite.config.ts`, `tsconfig.json`).

## Subcomponent layout

**[MODERATE]**
- **Sibling files**, prefixed with the parent's name, for < ~10 children: `agent-detail.tsx`, `agent-detail-header.tsx`, `agent-detail-credits.tsx`.
- **A nested folder** for 10+ children or a cluster with its own hooks/types/utils: `agent-detail/{index,header,credits,tools-list,tools-list-item}.tsx` + `utils.ts`.

No single-file folders; no 30 siblings sharing a prefix.

## Barrel files

**[HIGH] No `index.ts` barrels for component directories**: they break tree-shaking in some bundler setups, invite circular imports and cost maintenance for no consumer benefit. Import from the component's file. Allowed: `api/index.ts` as a module's single API surface, and a context module's `index.ts` re-exporting its hook to enforce the provider-only entry point.

## Imports

**[MODERATE]** Path aliases (`@/`, `#/`) for cross-module imports, relative for siblings. Don't introduce aliases mid-feature; propose them in a separate PR. `../../../` means the file is in the wrong folder.

## Migrating from a layer layout

- New features start in a module; never extend the old flat structure.
- **Touch-it = relocate-it**: when a change touches a cluster of files, move the cluster into its module in the same PR.
- Large batch moves are their own PR.
