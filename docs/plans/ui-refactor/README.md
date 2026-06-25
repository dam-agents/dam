# UI conformance refactor

Time-boxed plan to bring `packages/ui` into conformance with the
[`react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md)
skill. The skill is the rulebook (rules + severities); this doc is the
project-specific hotspot inventory, fix recipes, and PR tracker. Delete it once
the refactor lands.

## Baseline (2026-06-25)

The codebase is already clean on most CRITICAL rules — no `React.FC`, no raw
`fetch` in components, no server lists in Zustand, primitives isolated in
`components/ui/`, consistent kebab-case. The work is therefore mostly
**decomposition** of oversized files plus a few **HIGH-rule conformance**
passes, applied module by module.

## How we work

- **One PR per module** (`src/modules/{domain}/`). Each PR brings that module
  fully to standard. Group small/adjacent modules into one PR when the diff is
  thin — decide along the way, don't pre-commit to a count.
- **Commits grouped by concern** inside a PR: one atomic commit per hotspot
  split / form migration / hook split. For a batched-small-modules PR, one
  commit per module.
- **Cross-cutting rules are applied opportunistically, within the module a PR
  already touches** (touch-it = migrate-it) — not as horizontal sweeps. See
  [Cross-cutting policy](#cross-cutting-policy).
- **No behavior change.** These are pure refactors: existing tests + manual
  smoke must stay green. Don't author new tests by default; add one only when a
  split exposes genuinely untested, hard-to-smoke logic (and say so).
- **Each module PR is a dedicated refactor PR** — never mixed with feature
  work, per the skill's "batch migrations are a separate PR."

## Scope: structure, not visuals

This refactor changes **code shape** — decomposition, RHF migration, hook
splits, query keys, typing. It is **not** a visual pass. Component extraction
and form-RHF migration survive a restyle; swapping ad-hoc inputs/buttons for the
shared `components/ui/` primitives does not — a redesign would redo it.

The **chat-page modules — `sessions`, `files`, `schedules`, `skills`** (skills
lives in sessions) — are slated for a (non-drastic) redesign soon. For these:

- **Do the structural refactor now** (decompose, RHF, split hooks, type).
- **Leave visuals alone** — do **not** unify non-standard inputs/buttons to the
  shared primitives. If a structural change makes a visual unification tempting,
  **flag it and ask** rather than doing it; the redesign will handle the skin.

Stable (non-redesign) modules may be fully brought to standard, visuals
included.

## Hotspot inventory

### Oversized files (>250 lines — decomposition targets)

| Lines | Module | File | Note |
|---|---|---|---|
| 875 | sessions | `components/skills-panel.tsx` | multi-section panel; **touched by #276/#1898 — refactor only after they merge** |
| 812 | sessions | `views/chat-view.tsx` | split into message-list / input-region / config-region |
| 729 | agents | `dialogs/add-agent-dialog.tsx` | multi-step wizard → step components + hook |
| 639 | egress-rules | `components/agent-egress-editor.tsx` | table + inline forms → row + form extraction |
| 578 | connections | `forms/template-create-form.tsx` | RHF candidate (4 useState) |
| 460 | sandboxes | `hooks/use-sandbox-settings-form.ts` | god-hook → focused hooks; RHF |
| 435 | schedules | `forms/create-schedule-form.tsx` | RHF candidate (7 useState) |
| 431 | sessions | `components/session-config-popover.tsx` | extract provider/env/connection regions |
| 421 | shared | `components/connections-picker.tsx` | shared component; extract search + item |
| 418 | acp | `session-projection.ts` | ACP stream decoder; type the payloads |
| 377 | files | `components/files-panel-controller.ts` | mislocated → `hooks/use-files-panel.ts` |
| 353 | sessions | `components/chat-input.tsx` | extract suggestion list + autocomplete |
| 310 | files | `components/file-viewer.tsx` | extract preview / editor regions |
| 306 | sessions | `hooks/use-acp-connection.ts` | god-hook split |
| 306 | sessions | `components/channels-panel.tsx` | extract list item + filtering |
| 299 | files | `api/import-bundle.ts` | upload-orchestration helper; split |
| 288 | sessions | `hooks/use-acp-config-cache.ts` | god-hook split |
| 284 | files | `api/queries.ts` | split per-query |
| 273 | files | `hooks/use-file-mutations.ts` | split per-action |

### Forms over the RHF threshold (≥3 fields / cross-field / multi-step)

- `schedules/forms/create-schedule-form.tsx` (7 useState)
- `connections/forms/template-create-form.tsx` (4 useState)
- `sandboxes/hooks/use-sandbox-settings-form.ts` (multi-step state machine)

### HIGH cross-cutting gaps (fixed opportunistically per module)

- **Query-key factories** — only `files/api/keys.ts` exists; add one per module as its PR lands.
- **Selector hooks per Zustand slice** — components call `useStore((s) => …)` inline; export named selector hooks (`useSelectedAgentId`, `useToastActions`) with the owning module.
- **Typed boundaries** — ~230 `any`/`as`, mostly at API/Radix/icon edges. Defer broadly; the one with real bug risk is **untyped ACP stream payloads** (sessions/acp) — tackle in the sessions ACP-hooks PR.
- **Static inline styles** — ~14, most are legitimate dynamic CSS-var/depth/animation values; convert only the genuinely static ones where touched.

### Structural nits

- `files-panel-controller.ts` → `files/hooks/use-files-panel.ts` (naming + location).
- Zustand slices written as `.js` (`platform/store/*.js`, sessions `session-config.js`, `permissions.js`) → `.ts`.
- `providers/` has only `components/` — add `api/` when its PR lands.

## PR sequence

Status: ☐ todo · ◐ in progress · ☑ done

Stable modules (full refactor, visuals included) come first; the
**redesign-pending** chat modules (structure-only, visuals deferred) come after;
sessions is last.

| # | PR | Scope | Redesign-pending? | Status |
|---|----|-------|---|--------|
| 0 | foundations | this plan doc | — | ◐ |
| 1 | connections *(exemplar)* | `template-create-form`→RHF; decompose `connections-picker` (shared); query keys | no | ☐ |
| 2 | egress-rules | decompose `agent-egress-editor` | no | ☐ |
| 3 | sandboxes | split `use-sandbox-settings-form` god-hook; RHF | no | ☐ |
| 4 | agents | `add-agent-dialog` → steps + hook + RHF | no | ☐ |
| 5 | providers | add `api/`; tidy provider forms | no | ☐ |
| 6 | small-modules batch | approvals, api-keys, settings, terms, secrets, templates, usage, repos | no | ☐ |
| 7 | schedules | RHF `create-schedule-form`; split `schedule-card`; query keys | **yes — structure only** | ☐ |
| 8 | files | viewer; controller→hook; import-bundle; split queries/mutations | **yes — structure only** | ☐ |
| 9+ | **sessions** (incl. skills-panel) | **last** — shape decided from earlier PRs; after #276/#1898 merge | **yes — structure only** | ☐ |

**Why this order:** **connections** is a small, stable exemplar that exercises
both the form→RHF and decomposition recipes, locking them in for review before
wider use. Stable modules follow (safe to refactor *and* unify visually). The
redesign-pending chat modules come later and **structure-only**, so we don't
burn effort on visuals the redesign will redo. Sessions is last — largest,
riskiest, partly under active edit via #276/#1898 — and its sub-splitting is
decided once the recipes are proven.

`.js`→`.ts` for Zustand slices is done **with each owning module's PR**
(e.g. `session-config.js`/`permissions.js` in the sessions PRs), not as a
foundations sweep, since converting may surface type errors best handled in
context.

## Cross-cutting policy

When a module PR touches a file, bring that file fully to standard: extract
oversized components/hooks, migrate qualifying forms to RHF + Zod, add the
module's query-key factory, export selector hooks for slices it owns, and
tighten obvious boundary types. Do **not** open horizontal "all selector hooks"
or "all query keys" PRs — that contradicts touch-it = migrate-it and produces
unreviewably wide diffs.

When a hand-rolled generic primitive surfaces inside a feature file (the
`Switch`/`Badge`/`Spinner` kind), **flag it for the user** — promotion to
`components/ui/` is a human call, not an automatic move.

## Decisions log

- **Per-module PRs**, grouping small modules opportunistically; granularity
  revisited as we learn how big each diff is.
- **Cross-cutting handled opportunistically per module**, not as sweeps; broad
  `any` cleanup deferred except ACP payloads.
- **Structure, not visuals.** Chat-page modules (`sessions`, `files`,
  `schedules`, `skills`) get structural refactor only this round; visual
  unification of inputs/buttons is deferred to the upcoming redesign and is a
  flag-and-ask per case.
- **Exemplar is `connections`** (stable + exercises both recipes), not schedules
  (which is redesign-pending).
- **Sessions last**, shape (single vs multi-PR) decided from earlier refactors.
- **`.js`→`.ts` slices** done with each owning module's PR, not in foundations.
