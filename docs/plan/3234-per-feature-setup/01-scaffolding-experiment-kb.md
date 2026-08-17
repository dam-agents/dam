# 01 — Setup-page scaffolding, experiment and knowledge base

**Part of:** Separate creation flow for coding agents, experiments and knowledge bases — see [README](./README.md)

## Context

This slice builds the spine all three setup pages stand on, and proves it with the two flows that need no image choice. The experiment page is name, provider, connections; the knowledge base page adds a template section. The coding-agent page follows in slice 02 and the wizard dies in slice 03, so the wizard stays reachable and untouched here.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. Routes — `packages/ui/src/modules/platform/lib/routes.ts`

Add three views: `coding-agent-new`, `experiment-new`, `knowledge-base-new`, at `/coding-agents/new`, `/experiments/new` and `/knowledge-bases/new`.

Order matters in `parseRoute`: the `/knowledge-bases/:id` and `/coding-agents` patterns must not swallow `/new`. `/knowledge-bases/new` already has an early return mapping it to the wizard — repoint it. Match `/coding-agents/new` before any `/coding-agents` handling.

Add all three to the `ParameterlessView` union in `modules/platform/store/navigation.ts`, and add the three paths to the round-trip fixture list in `packages/ui/src/__tests__/unit/routes.test.ts` — that is completing an existing table, not writing a new test.

Render them from `app.tsx` in the same container branch as the other list views.

### 2. Form state — `packages/ui/src/modules/sandboxes/hooks/use-setup-form.ts`

A hook owning what every flow shares: `name`, `providerRef`, `connectionIds`, plus a `templateId`/`kbTemplateId`/`customImage` the flows that need them use.

- Model it on `use-sandbox-wizard.ts` and the Zod-validated `sessionStorage` snapshot in `lib/wizard-snapshot.ts` — same shape of `load`/`save`/`clear`, same reason (the OAuth round-trip). Drop `step`, `maxStep`, `startingPoint`, `egressPreset`, `sizeCpuMilli`, `sizeMemoryMi`.
- Key the stored snapshot **per flow**, so an abandoned experiment form cannot bleed into a knowledge-base form.
- Generate the name on first mount with `generateSandboxName()` from `lib/sandbox-name.ts`, as the wizard does when it reaches step 2 — the prototype shows the field prefilled.
- `reset()` clears the stored snapshot; each flow calls it after a successful create, as the wizard does.

Leave `wizard-snapshot.ts` in place for now; slice 03 removes what is then dead. Keep `KINDED_HARNESS_TEMPLATE_ID` and `providerPolicy` — both are still needed.

### 3. Page shell — `packages/ui/src/modules/sandboxes/components/setup-page-shell.tsx`

Title, subtitle, the stacked sections as children, and the create button. Reuse `sticky-footer-layout.tsx` if it fits the single-page form; otherwise place the button at the end, bottom-right, as the prototype's experiment and knowledge-base screenshots show. Do not reuse `sandbox-wizard-shell.tsx` — it exists for the step indicator, which is gone.

### 4. Shared sections

Extract from the wizard's steps so slices 02 and 03 do not copy them:

- **Name** — the `FormField` + `Input` block from `steps/setup-step.tsx`.
- **Provider** — the `SectionLabel` + `Inset` + `ProviderSelect` block from the same file, still passing `providerPolicy(...)`'s `allow`/`recommended`. Extend the preselection so LiteLLM wins when the user has one: `ProviderSelect` already takes `autoSelectFirst` and `recommended` — check whether `recommended` already drives auto-selection before adding anything, and prefer fixing it there over duplicating the logic per page.
- **Connections** — `GrantedConnectionsPanel` plus the catalog modal, as in `steps/connections-step.tsx`, but with the OAuth return path passed in by the page rather than hardcoded to the wizard.

Keep the section components dumb: value in, change handler out.

### 5. Experiment page — `packages/ui/src/modules/experiments/views/experiment-setup-view.tsx`

"Setup your experiment" / "Name your experiment, choose a provider, and add connections." Name, Provider, Connections, then **Create experiment**.

Submit calls `useCreateExperimentSandbox()` with `templateId: KINDED_HARNESS_TEMPLATE_ID`, the name, `egressPreset: "trusted"`, and the granted connections plus the provider connection — mirror exactly what `sandbox-wizard-view.tsx`'s `finish()` sends for the experiment branch, minus size. On success, `reset()` then `selectAgent(agent.id)`.

### 6. Knowledge base page — `packages/ui/src/modules/knowledge-bases/views/knowledge-base-setup-view.tsx`

"Setup your knowledge base" / "Name your knowledge base, choose a template, and add connections." Name, **Template**, Provider, Connections, then **Create knowledge base**.

The template section reuses `steps/kb-template-card.tsx` over `KB_TEMPLATES`, with `DEFAULT_KB_TEMPLATE_ID` preselected. Submit calls `useCreateKnowledgeBase()` exactly as the wizard's knowledge-base branch does, minus size; on success `reset()` then `openKnowledgeBase(agent.id)`.

### 7. Entry points for these two flows

Point the existing "Create experiment" and "Create knowledge base" buttons — in `experiments-list-view.tsx`, `knowledge-bases-list-view.tsx`, and the two matching cards in `modules/agents/components/welcome-entry-points.tsx` — at the new routes instead of `navigateToCreateSandbox(...)`. Leave the coding-agent card and Home's "Create sandbox" on the wizard until slice 02.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] All three new paths round-trip through `parseRoute`/`routeToPath`; `/knowledge-bases/:id` and `/knowledge-bases/:id/settings` still resolve.
- [ ] `/experiments/new` creates an experiment sandbox that reaches running and opens in chat.
- [ ] `/knowledge-bases/new` creates a knowledge base with the LLM Wiki template and opens its chat.
- [ ] Both pages open with a generated name and, where a LiteLLM connection exists, LiteLLM already selected.
- [ ] Adding a connection through OAuth returns to the same page with the connection granted and the name and provider still set.
- [ ] Neither page asks for size or network access, and both created sandboxes carry the `trusted` egress preset.
- [ ] The wizard still works unchanged at `/sandboxes/new`.
- [ ] The two form states do not share a `sessionStorage` key.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`:

1. Open `/experiments/new` from the Experiments page button. Confirm the prefilled name, the provider default, then create — the sandbox appears and opens in chat.
2. Open `/knowledge-bases/new`. Confirm LLM Wiki is selected, create, and confirm the knowledge base chat opens.
3. On either page, add a connection via OAuth and confirm the form comes back intact with it granted.
4. Visit `/sandboxes/new` and confirm the old wizard still works end to end.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
