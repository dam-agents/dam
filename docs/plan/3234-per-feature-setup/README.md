# Separate creation flow for coding agents, experiments and knowledge bases

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** [#3234](https://github.com/dam-agents/dam/issues/3234)

## Goal

Each of the three things a user can create gets its own setup page, asking only what that thing needs, with the sensible choice already made. A user creating a knowledge base is never shown harness images or experiment options; a user creating a coding agent picks an image and goes.

Today all three funnel through one three-step wizard whose first step asks "which of five starting points?" before anything else. The entry cards on Home and the nav destinations then all land in the same place, and the user has to re-answer a question their click already answered.

## Approach

**One page per flow, no steps.** Following `jamiejabbouribm`'s prototype on the issue: a single scrolling form with a title, a subtitle, stacked labelled sections, and one create button. No step indicator, no Continue.

| Route | Title | Sections | Creates via |
| --- | --- | --- | --- |
| `/coding-agents/new` | Setup your coding agent | Name · Image · Provider · Connections | `agents.create` |
| `/experiments/new` | Setup your experiment | Name · Provider · Connections | `experiments.createSandbox` |
| `/knowledge-bases/new` | Setup your knowledge base | Name · Template · Provider · Connections | `knowledgeBases.create` |

`/knowledge-bases/new` exists today as a legacy alias for the wizard; it becomes the real knowledge-base page.

**The three flows share their spine, not their sections.** Name, provider and connections behave identically in all three, and all three must survive an OAuth round-trip: adding a connection navigates to the provider and comes back with `?oauth=success&connection=<id>`, which is why today's wizard persists its state to `sessionStorage`. That persistence stays; what goes is the wizard's step machinery (`step`, `maxStep`, `startingPoint`). Each page passes **its own** route as the OAuth return path — today `connections-step.tsx` hardcodes the wizard's.

**Decisions taken with the user.** These are settled; do not relitigate them while implementing:

- **Size and network access leave creation.** Neither appears in the prototype. A new sandbox takes the template's size and the `trusted` egress preset, both editable in sandbox settings immediately after creation. `egressPreset` still reaches the create call — as a constant, not a question.
- **Specialized images live in the coding-agent page's image grid**, as a labelled group after the harnesses, keeping their experimental badge. The chart ships seven of them enabled (`k-search`, `nous`, `openevolve`, `shinkaevolve`, `gepa`, `adaevolve`, `evox`), the newest added twelve days before this plan, so they must stay creatable. The prototype shows only harnesses; this is a deliberate addition.
- **Routes are resource-shaped** (`/coding-agents/new`, not the prototype's `/agent-setup`), matching the rest of the app.
- **The wizard is deleted**, not kept alongside. `/sandboxes/new` redirects to the coding-agent page.

**Defaults**, from `jenna-winkler`'s notes on the issue:

- All three flows preselect the **LiteLLM** provider when the user has one; otherwise fall back to today's "first available" behaviour. `providerPolicy` still restricts the experiment and knowledge-base flows to LiteLLM and Anthropic.
- The coding-agent flow preselects **Claude Code**.
- The knowledge-base flow preselects the **LLM Wiki** template.

**Kept as is:** the private-registry disclosure on the custom-image card, explicitly at jenna's request.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Setup-page scaffolding, experiment and knowledge base | The three routes, the shared form hook and page shell, LiteLLM preference; the two image-free flows wired end to end | — |
| 02 | Coding agent setup page | The image grid (harnesses + specialized), the custom-image card with registry credentials, Claude Code preselected | 01 |
| 03 | Retire the wizard | Delete the wizard and its steps, redirect `/sandboxes/new`, re-point every entry point, fix the e2e smoke spec | 02 |

## Conventions & glossary

- **Flow** — one of the three creation paths. **Setup page** — the single-page form for a flow. **Section** — a labelled block within it (Name, Image, Provider, Connections).
- Apply the `/react-ui-engineering` skill throughout; this feature is `packages/ui` only. No tRPC contract changes: all three create mutations already exist and keep their inputs.
- State lineage: form state is UI-local to a page, persisted to `sessionStorage` **only** so the OAuth round-trip can resume. It is not server state and does not belong in TanStack Query or Zustand.
- Run `mise run ui:fix` after edits, then `mise run --force ui:check` and `--force ui:test`. Always pass `--force` — mise caches per task and will otherwise report a check it skipped.
- No code comments except the registered typed prefixes. Never hardcode the brand.
- Copy comes from the prototype's screenshots on the issue, verbatim where they show it.

## Whole-feature smoke test

On the Vite dev server, signed in:

1. From Home's three entry cards, land on `/coding-agents/new`, `/experiments/new` and `/knowledge-bases/new` respectively — no wizard, no starting-point question.
2. Each page opens with its default made: Claude Code, LLM Wiki, LiteLLM where a LiteLLM connection exists.
3. Create one of each. Every sandbox reaches running, the coding agent and experiment open in chat, the knowledge base opens its chat.
4. On the coding-agent page, confirm a specialized image is offered and badged, and that a custom image with private-registry credentials still creates.
5. Add a connection mid-form through OAuth and confirm the form returns with the connection granted and the rest of the form intact.
6. Visit `/sandboxes/new` and confirm it redirects to the coding-agent page.
7. `mise run --force test` — the e2e smoke spec drives the new page, not the wizard.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for [#3234](https://github.com/dam-agents/dam/issues/3234).

The branch starts from `feat/3214-welcome-entry-points` (PR #3348), which introduces the Home entry cards, the Coding agents page and the nav this feature hooks into. Rebase onto `main` once #3348 merges.
