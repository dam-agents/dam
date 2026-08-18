# 03 — Retire the wizard

**Depends on:** 02-coding-agent-setup
**Part of:** Separate creation flow for coding agents, experiments and knowledge bases — see [README](./README.md)

## Context

With all three setup pages live, the three-step wizard has no entry point left. This slice deletes it, redirects its route, and updates the one e2e spec that drives it. Nothing here is optional: leaving the wizard in place means two creation paths, and leaving the spec alone means red CI.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. Redirect `/sandboxes/new`

Keep the path resolving — it is in browser histories, and `app.tsx` skips its OAuth handling for that route. Map it to the coding-agent page rather than 404-ing or falling through to Home. Decide it in `parseRoute` (so `/sandboxes/new` parses as the coding-agent view) and confirm `routeToPath` never emits the old path afterwards. The round-trip fixture in `packages/ui/src/__tests__/unit/routes.test.ts` asserts identity, so `/sandboxes/new` cannot stay in that list — move it to the existing non-round-trip group of assertions beside the other legacy-path case (`/knowledge-bases/new`, which is already handled that way).

### 2. Delete the wizard

- `views/sandbox-wizard-view.tsx`
- `components/sandbox-wizard-shell.tsx`, `components/wizard-step-indicator.tsx`, `components/step-header.tsx`
- `components/steps/starting-point-step.tsx`, `components/steps/starting-point-row.tsx`, `components/steps/setup-step.tsx`, `components/steps/connections-step.tsx`
- `hooks/use-sandbox-wizard.ts`
- Its branch in `app.tsx`, and `navigateToCreateSandbox` in `modules/platform/store/navigation.ts` once nothing calls it.

Keep everything the setup pages compose: `steps/harness-card.tsx`, `steps/kb-template-card.tsx`, `steps/custom-image-card.tsx`, `steps/selectable-card.tsx`, `steps/card-content.tsx`, `steps/card-tags.tsx`, `card-list.tsx`, `registry-credential-section.tsx`, `granted-connections-panel.tsx`, `lib/sandbox-name.ts`, `lib/provider-connections.ts`.

Two more things fall dead now that specialized images are not offered: `steps/workload-card.tsx`, whose only caller was the wizard's starting-point step, and the `preconfigured` half of `lib/image-catalogue.ts`. Delete the card; reduce the catalogue to the harness list it still serves, keeping its `vm-sandboxes` filtering. Grep first — if anything outside the wizard reads `preconfigured`, stop and report rather than deleting.

`step-header.tsx` may be used outside the wizard — grep before deleting, and the same for every file above. `NETWORK_PRESETS` currently lives in `setup-step.tsx`; grep for it, because the sandbox settings surface may import it from there.

### 3. Prune `lib/wizard-snapshot.ts`

Slice 01 left it in place. Remove what is now dead — the snapshot schema, `step`/`maxStep`, `startingPoint`, `startingPointDefaults`, `startingPointComplete`, and the load/save/clear pair if the setup form has its own. Keep `KINDED_HARNESS_TEMPLATE_ID`, `providerPolicy`, `egressPresetSchema` and `EgressPreset` — all still used. Rename the file if what remains is no longer "wizard" anything.

### 4. The e2e smoke spec

`packages/e2e/playwright/src/tests/smoke/03-agent.spec.ts` drives the wizard: it clicks a create button, then `starting-point-general-purpose`, then a template card, then Continue, then fills the name and provider on step 2, then Continue, then "Create sandbox" on step 3. Rewrite that sequence for the single page: open `/coding-agents/new` (via the UI, as it does now), pick the mock template card, set the name, connect the provider, then click "Create coding agent".

The specs that follow (04, 05, 12) depend on the sandbox 03 creates, so this must keep producing the same sandbox with the same name and provider. Do not weaken the spec into something that passes without creating anything.

Run `mise run --force e2e-playwright:check` after editing. The suite itself needs a cluster (`mise run e2e`); if you cannot run it, say so plainly in your report rather than implying it passed.

### 5. Copy sweep

Grep for wizard-shaped wording left behind — "starting point", "step 1", "Continue" — in `packages/ui` and in `docs/`. Fix anything that now describes something that does not exist.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test`, `--force e2e-playwright:check` and `--force common:check:comment-types` pass.
- [ ] `mise run --force test` passes.
- [ ] `/sandboxes/new` lands on the coding-agent setup page; `parseRoute`/`routeToPath` stay consistent and the routes test reflects the legacy mapping.
- [ ] No file in the repo imports a deleted module; no dead export is left behind in `wizard-snapshot.ts`.
- [ ] `grep -ri "starting point" packages/ui docs` returns nothing that describes current behavior.
- [ ] The e2e smoke spec creates its sandbox through the new page, with the same name and provider as before.
- [ ] All three flows still create successfully after the deletions.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
mise run --force e2e-playwright:check
mise run --force test
```

Then on the dev server at `localhost:5173`:

1. Visit `/sandboxes/new` and confirm it lands on the coding-agent page.
2. Create one of each of the three kinds and confirm each reaches running.
3. Confirm no route or button anywhere still opens a stepped wizard.

The full e2e suite needs a cluster and takes a long time; run it if the user asks, and otherwise report clearly that only the spec's type and lint checks were run.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
