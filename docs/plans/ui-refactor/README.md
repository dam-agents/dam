# UI refactor plan — `packages/ui`

First-pass refactor of platform's `packages/ui` toward the [React + TypeScript UI engineering skill](../../../.agents/skills/react-ui-engineering/SKILL.md). The skill holds the rules and severity tiers; this plan holds the execution process, the ordered steps, and the progress tracker. Delete this folder once the matrix is fully green.

---

## Process

**Domain-major, one commit per step, one PR per domain (or more).** Pick a domain, walk the step files in order, make one commit per step. Open the PR once the domain is fully refactored. This is a fresh app so reviewer bandwidth isn't the bottleneck — if two adjacent small domains fit naturally in one PR (e.g., `schedules` + `files`), batch them. Default is one-PR-per-domain; batch opportunistically.

Steps that are a no-op in a domain (nothing to change) are skipped entirely — no empty commit, just mark the matrix cell `—`.

**Why domain-major:** if we pause work, each touched domain ends in a fully-refactored state rather than every domain half-done. It also keeps review cognitive load scoped to one feature area at a time.

**Step order is fixed.** Earlier steps create the foundation later steps assume:

1. **Project structure** — move files into `modules/{domain}/`.
2. **Data layer** — fetchers isolated, TanStack Query everywhere, Zod at boundaries.
3. **State management** — server state out of Zustand, selector hooks, split state/actions.
4. **Splitting** — god components and god hooks broken apart by responsibility.
5. **Forms** — RHF + Zod where the threshold is met.
6. **Styling** — Tailwind only, no static `style={{}}`.
7. **Clean code** — `any` → proper types (Zod-inferred), DRY sweep, naming, comments.

Step files live in [`steps/`](steps/). Domain files live in [`domains/`](domains/) — each scopes the files involved and flags domain-specific gotchas (Playwright vs user testing, protocol types, etc.).

---

## Target module layout

Current `packages/ui/src` is flat by technical layer (`components/`, `dialogs/`, `views/`, `panels/`, `hooks/`, `store/`). Target: domain modules per [`references/project-structure.md`](../../../.agents/skills/react-ui-engineering/references/project-structure.md).

Proposed modules:
`agents`, `instances`, `sessions`, `acp`, `secrets`, `connections`, `schedules`, `templates`, `files`, `platform` (tRPC + auth).

Shared (stays at top level):
- `components/` — primitives only: `modal.tsx`, `button.tsx`, `status-indicator.tsx`, `toast-overlay.tsx`, `markdown.tsx`, icons.
- `hooks/` — generic only (e.g., `use-auto-resize.ts`).
- `utils/` — format/classification helpers with no domain.

## File conventions

- **Naming:** kebab-case for all `.ts`/`.tsx` files — consistent with the current codebase.
- **Imports:** keep relative imports with `.js` extensions for now. Path aliases are out of scope for this refactor.
- **Styling:** Tailwind only. Theme-aware values via CSS custom properties in `index.css`; dark mode via class-based `.dark` on `<html>`.

---

## Progress matrix

`☐` = todo, `🟡` = in PR, `✅` = done, `—` = no-op (nothing to do in this domain).

| Domain \ Step | 01 structure | 02 data | 03 state | 04 splitting | 05 forms | 06 styling | 07 clean |
|---|---|---|---|---|---|---|---|
| [connections](domains/connections.md) | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| [chat](domains/chat.md) | ✅ | ✅ | ✅ | ✅ | — | ✅ | 🟡 |
| [agents](domains/agents.md) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [secrets](domains/secrets.md) | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| [schedules](domains/schedules.md) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [files](domains/files.md) | ✅ | ✅ | ✅ | ✅ | — | — | — |
| [settings](domains/settings.md) | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |

Update cells as part of the PR that completes the work. Link the PR next to the domain name if useful (`[connections](domains/connections.md) ([#XYZ](...))`).

---

## Verification

Every step file ends with a **How to verify** section. Three modes, in preference order:

1. **Automated check** — `mise run check`, unit tests, Playwright scripts. Use whenever possible.
2. **Playwright walkthrough** — scripted flow against the dev server (`mise run ui:run`). Preferred for chat, connections, auth flows.
3. **User test** — explicit handoff when automation can't cover it (visual polish, drag-drop, native file pickers). The step file must name the flow ("user: open Settings → switch theme → reload, theme persists").

No step lands without verification. If the recipe is a pure mechanical move (step 01), "`mise run check` passes and the app boots" is enough.

---

## Lint scope

ESLint's strict rule set (`typescript-eslint/recommended`, `consistent-type-imports`, `simple-import-sort`, `react-hooks`) is scoped to `packages/ui/src/modules/**` in `eslint.config.js`. Legacy files outside `modules/` keep only the baseline rules (kebab-case filenames, tseslint base) so this refactor stays the only thing driving those churn edits. Files pick up the strict rules automatically the moment they move into `modules/` during step 01 — that's what makes each domain's step 01 also a lint baseline.

**Before merging a domain's work:** run `mise run lint:fix` (auto-fixes import order, `import type`) and make sure `mise run lint:check` is clean.

**Post-migration cleanup** (track, don't forget when the last domain is done):
1. Drop the `packages/ui/src/modules/**` block in `eslint.config.js`.
2. Widen the `tseslint.configs.recommended` + `simple-import-sort` + `react-hooks` rules to `packages/ui/**` (or `packages/**` where appropriate).
3. Run `mise run lint:fix` across the codebase; fix the remaining errors (`no-explicit-any` in protocol surfaces, stray `no-unused-expressions`, etc.).
4. Delete this whole plan folder.

## Branch & commit conventions

- One branch per domain (or per batch): `refactor/ui-{domain}` — e.g., `refactor/ui-connections`. For batched domains: `refactor/ui-{domain1}-{domain2}`.
- One commit per step, conventional: `refactor(ui/{domain}): {step goal}` — e.g., `refactor(ui/connections): migrate to TanStack Query`. Keeps the history step-scannable even though the PR bundles them.
- Always `git commit -s` for DCO.
- PR title summarizes the domain(s): `refactor(ui/{domain}): apply UI engineering rules`.
- PR body: link to the domain file(s); list the step commits; tick the matrix cells.
