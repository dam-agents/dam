# 03 — Connection rows: steps and tags

**Depends on:** 02-radio-connect-pane
**Part of:** GitHub connection — one choice, three clear options — see [README](./README.md)

## Context

After creating an OAuth GitHub connection, the org-install step is easy to miss: today it's a
subdued callout ("GitHub app connections need one more step…") and a small per-row link. Per
the design ([`design/DAM.png`](./design/DAM.png), [`DAM-1.png`](./design/DAM-1.png)), the
remaining steps become a prominent numbered callout above the row, the row gets a primary
"Install {brand} app ↗" button, and every GitHub connection row carries a method tag. This
slice also lands the architecture-doc updates for the whole feature.

## Implementation plan

Apply the /react-ui-engineering skill. Paths under `packages/ui/src/modules/connections/`
unless noted.

1. **Method tags** — `connectionKindSubtitle()` in `lib/catalog-providers.ts` (~201–218)
   currently renders as a plain row subtitle (`components/catalog-connection-row.tsx` ~53).
   Per design the method is a grey pill/tag next to the connection name:
   - `github`, `github-enterprise` → "GitHub app"
   - `github-app`, `github-enterprise-app` → "GitHub app (installation)"
   - `github-pat`, `github-enterprise-pat` → "GitHub personal access token"
   - non-GitHub templates keep their current subtitle text, restyled consistently or left as
     subtitle — follow the design's row layout ([`design/DAM-1.png`](./design/DAM-1.png)).
2. **Steps callout** — `components/github-app-install-hint.tsx`. `GithubAppInstallHint`
   (~20–39) becomes the design's callout: bold "2 steps required for successful connection",
   numbered list "1. Authorize GitHub account / 2. Install the {brand} application within your
   organization" (`getBrand()`), rendered above the unfinished connection's row inside the
   group card. Keep the existing gating heuristic — `activeInstallUrl()` (~15–18) →
   `lib/github-app-install-url.ts` (`appSlug` present + `status === "active"`). Mount points
   stay `components/connection-group-card.tsx` (~59) and `components/catalog-provider-card.tsx`
   (~71); the callout must sit visually with the row it belongs to when a group holds several
   connections ([`design/DAM-1.png`](./design/DAM-1.png) shows it wrapping only the OAuth row).
3. **Install button** — `GithubAppInstallLink` (~41–57), rendered from
   `components/connection-row-actions.tsx` (~52), turns into a primary (filled) button
   "Install {brand} app" with an external-arrow Carbon icon, same target URL. Keep it out of
   the overflow menu — it's the row's main call to action while the step is open.
4. **Same treatment in the catalogue modal** — the browse pane's `catalog-provider-card.tsx`
   shows the identical callout + button for an unfinished connection.
5. **Architecture docs** (follow `docs/guidelines/documentation-guidelines.md`):
   - `docs/architecture/connections.md` — the internal-only paragraph (~line 52) no longer
     lists GitHub App as hidden; the GitHub App auth-mode prose stays. Mention the
     `github-enterprise-pat` template where GHE examples enumerate GitHub entries. Bump
     `Last verified:`.
   - `docs/architecture/features.md` — the "current feature" sentence (~line 10) and anything
     naming GitHub App under `advanced-connections`. Bump `Last verified:`.
6. Run `mise run ui:fix`, `mise run common:check:comment-types`, `mise run check`,
   `mise run test`. Also run `/doc-drift` mentally against the diff: no other page should
   reference the removed chooser pane.

## Acceptance criteria

- [ ] An active OAuth GitHub connection with an `appSlug` shows the numbered 2-steps callout
      and a primary "Install {brand} app ↗" button on its row; PAT and GitHub App connections
      show neither.
- [ ] Rows show the three method tags per the mapping above, on the agent page
      ("My connections"), the settings connections view, and the catalogue modal.
- [ ] Brand never hardcoded; `getBrand()` used in all new copy.
- [ ] `docs/architecture/connections.md` and `docs/architecture/features.md` match the shipped
      behavior, with bumped `Last verified:` dates.
- [ ] `mise run check`, `mise run test`, `mise run common:check:comment-types` pass.

## Smoke test

`mise run test` and `mise run check`. Manually on the Vite dev server: with one connection per
method (from sub-issue 02's smoke test), open the agent page's Connections section and compare
rows against [`design/DAM.png`](./design/DAM.png) and [`DAM-1.png`](./design/DAM-1.png) —
callout + button only on the OAuth row, tags on all three. Print those steps as the manual
guide for the user.
