# 02 — Radio-toggle connect pane

**Depends on:** 01-ghe-pat-template
**Part of:** GitHub connection — one choice, three clear options — see [README](./README.md)

## Context

Today, clicking **New** on the GitHub card opens a separate "Choose an authentication method"
pane, then the form — and the GitHub App templates are hidden behind the `advanced-connections`
feature and appear (when revealed) as standalone provider cards instead of GitHub methods. This
slice makes **New** open one create pane where the provider's templates are radio options that
toggle their fields in place ([`design/DAM-4.png`](./design/DAM-4.png) –
[`DAM-6.png`](./design/DAM-6.png)), regroups the GitHub App templates under their providers,
takes them off the hide-list, and rewrites the per-option copy.

## Implementation plan

Apply the /react-ui-engineering skill. All paths under `packages/ui/src/modules/connections/`
unless noted.

1. **Regroup providers** — `lib/catalog-providers.ts`, `STATIC_PROVIDERS` (~lines 36–47):
   GitHub = `[github, github-pat, github-app]`; GitHub Enterprise =
   `[github-enterprise, github-enterprise-pat, github-enterprise-app]`. Order = radio order in
   the design: OAuth, PAT, GitHub App.
2. **Un-hide GitHub App** — `internal-only.ts` (~lines 3–9): remove `github-app` and
   `github-enterprise-app` from `INTERNAL_ONLY_TEMPLATE_IDS`. Update the
   `advanced-connections` feature description in
   `packages/ui/src/modules/features/components/features-tab.tsx` (~lines 18–22) to drop the
   GitHub App mention, and update
   `packages/ui/src/__tests__/unit/internal-only-templates.test.ts`.
3. **Collapse the chooser into the create pane** — `components/connection-catalog-modal.tsx`:
   - `openNew()` (~lines 77–88): always go straight to `create`, defaulting to the group's
     first template.
   - Drop the `choose` pane state (~lines 33–37), `ChoosePane` (~lines 189–211), and
     `components/catalog-method-chooser.tsx`; simplify `backFromCreate` (~lines 103–110) —
     back always returns to `browse`.
   - The create pane header stays "Connect GitHub" / "Connect GitHub Enterprise" with the back
     arrow ([`design/DAM-4.png`](./design/DAM-4.png)).
4. **Radio option list** — new component in `components/` rendering the group's templates with
   the existing `RadioGroup`/`RadioGroupItem` primitive
   (`packages/ui/src/components/ui/radio-group.tsx`; usage example
   `forms/github-app-scope-sections.tsx` ~70–91). Each option is a bordered card: title,
   one-line description, radio on the right; the **selected** card expands to contain that
   template's form fields (reuse `forms/template-create-form-body.tsx` — it already renders
   fields from `template.inputs`, the `bringYourOwnApp` hint, and the github-app scope picker).
   Selecting a radio switches the active template; carry the typed connection name across
   toggles where fields overlap (single form with per-template field subsets, or reset-safe
   state — implementer's call, but the name must not vanish on toggle). A single-template group
   (Modal, Kubernetes, custom types) renders the form without the radio chrome — behavior
   unchanged.
5. **Copy rewrite** — `lib/catalog-providers.ts` `METHOD_COPY` (~77–88) becomes the radio-card
   copy; add github-app + all enterprise entries. From the design:
   - *Authorize with GitHub* — "Connect by logging in with your GitHub account — no token to
     create or paste." Selected state shows the callout **"2 steps required for successful
     connection: 1. Authorize GitHub account 2. Install the {brand} application within your
     organization"** (brand via `getBrand()`).
   - *Connect with a personal access token* — "Paste a token you create on GitHub. Best when
     finer-grained access is preferred." Below the secret field: "Create a token at
     github.com/settings/tokens" (link; for GHE, derive from the host input or omit).
   - *Connect your GitHub App* — "Agents act as a bot and your org owns the app." Field hints
     per [`design/DAM-6.png`](./design/DAM-6.png) (App ID / Installation ID) go in
     `forms/field-copy.ts` if not already present.
   - Update `CREATE_COPY` (~102–115) for the merged pane; review
     `forms/template-explainer.tsx` ("How does GitHub authorization work?") — the 2-steps
     callout supersedes it for OAuth; remove it if fully redundant with the new copy.
6. **Per-option submit label** — footer primary button follows the selected template:
   OAuth → "Continue to GitHub ↗" (external-arrow icon, Carbon), header/PAT → "Create token"
   (per design), github-app → "Connect app". Keep `data-testid="connection-create-submit"`.
   Submit paths themselves are untouched (`hooks/use-template-create-submit.ts`,
   `lib/build-create-payload.ts`).
7. **Test ids** — replace `catalog-method-<templateId>` with `catalog-option-<templateId>` on
   the radio cards; grep `packages/e2e/playwright/` for `catalog-method-` and update (the smoke
   helpers drive custom headers, but verify).
8. Run `mise run ui:fix`, then `mise run check` / `mise run test`.

## Acceptance criteria

- [ ] **New** on GitHub opens the create pane directly; three radio options; toggling swaps
      fields in place; no separate chooser pane remains in the code.
- [ ] Same for GitHub Enterprise, including the PAT option with a required host.
- [ ] GitHub App options are visible with `advanced-connections` **off**; `spotify`,
      `youtube`, `custom-client-credentials`, `google-*` remain hidden.
- [ ] Standalone "GitHub App (installation)" / "GitHub Enterprise (App installation)" provider
      cards no longer appear — those templates live only inside their provider groups.
- [ ] Copy matches the design (brand interpolated, "GitHub" spelling); submit label follows the
      selected option.
- [ ] Single-template providers (Modal, Kubernetes, custom MCP/OAuth/header) are unaffected.
- [ ] `mise run check`, `mise run test`, `mise run common:check:comment-types` pass.

## Smoke test

`mise run test` and `mise run check`. Manually, on the Vite dev server (`localhost:5173`):
open the Connection catalogue → GitHub → New; toggle all three radios and compare against
[`design/DAM-4.png`](./design/DAM-4.png)–[`DAM-6.png`](./design/DAM-6.png); repeat for GitHub
Enterprise; create a PAT connection end-to-end. Print those steps as the manual guide for the
user.
