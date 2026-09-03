# GitHub connection — one choice, three clear options

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3439
**Design:** https://www.figma.com/design/zNIYydUKN1QLZDYozpQJpn/DAM-DEV?node-id=2154-432 — exported screenshots in [`design/`](./design/)

## Goal

A user who connects GitHub picks the right option for their repository without guesswork. The
connect pane shows all three methods — sign-in (OAuth), personal access token, your own GitHub
App — as radio buttons that toggle in place, each with copy that says what the agent gets and
which steps need an administrator. The same three options exist for GitHub Enterprise,
including a new Enterprise PAT option (absorbs #3484). The GitHub App option leaves the
experimental-feature hide-list. After creation, the remaining steps ("install the app in your
organization") stay visible on the connection row with a prominent install button.

Descoped by decision: deliverable 6 of the issue (a linkable "who can read code my agent
holds" answer) — the design does not cover it; no follow-up filed. Install-state detection is
the last, optional sub-issue; whether it ships is decided at that point based on complexity.

## Approach

Almost everything is inside the Connections bounded context. Read
[`docs/architecture/connections.md`](../../architecture/connections.md) first;
[`docs/architecture/features.md`](../../architecture/features.md) for the hide-list gate.

- **Server** (`packages/api-server/src/modules/connections/`): templates are code-level catalog
  entries in `domain/catalog.ts`; input shapes come from `inputsFor()` in
  `domain/connection-template.ts`; a create projects inputs into contributions in
  `domain/build-connection.ts`. Sub-issue 01 adds the `github-enterprise-pat` template there.
- **UI** (`packages/ui/src/modules/connections/`): the catalogue modal is a pane state machine
  in `components/connection-catalog-modal.tsx`; today a multi-template provider (GitHub =
  OAuth + PAT) inserts a separate "choose an authentication method" pane — the extra click the
  issue removes. Sub-issue 02 replaces that pane with in-place radio options on the create
  pane and regroups the GitHub App templates under their providers. Sub-issue 03 restyles the
  connection rows (tags, steps callout, install button).
- **Hide-list**: there is no dedicated GitHub App flag. `github-app` and
  `github-enterprise-app` sit in `INTERNAL_ONLY_TEMPLATE_IDS`
  (`packages/ui/src/modules/connections/internal-only.ts`), gated client-side by the
  `advanced-connections` per-user feature. Un-hiding = removing the two ids; the flag itself
  stays (Spotify, Google, client-credentials still use it).
- **Install-steps banner**: an install hint already exists
  (`components/github-app-install-hint.tsx`) driven by a pure heuristic — OAuth connection,
  `status === "active"`, template carries an `appSlug`. Sub-issues 01–03 keep that heuristic;
  a persisted "not finished" state is sub-issue 04, optional.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | ✅ [GHE personal access token template](./01-ghe-pat-template.md) | Server: `github-enterprise-pat` catalog entry + GHE header contributions | — |
| 02 | ✅ [Radio-toggle connect pane](./02-radio-connect-pane.md) | UI: one create pane, 3 radio options per provider, un-hide GitHub App, rewritten copy | 01 |
| 03 | ✅ [Connection rows: steps and tags](./03-connection-row-steps.md) | UI: steps callout, method tags, install button; architecture-docs updates | 02 |
| 04 | ⏭️ skipped [Install detection (optional)](./04-install-detection-optional.md) | Decided against: installs are per-organization, a boolean "installed" check misleads | 03 |

## Conventions & glossary

- Apply **/typescript-engineering** for any server-side TS (sub-issues 01, 04) and
  **/react-ui-engineering** for `packages/ui` work (02, 03, 04).
- **Branding**: never hardcode `DAM` in code. Design copy like "Install the DAM application
  within your organization" and "Install DAM app" must interpolate the brand via `getBrand()`
  ([`packages/ui/src/brand.ts`](../../../packages/ui/src/brand.ts)).
- Design copy writes "Github" inconsistently; use **GitHub** everywhere.
- After UI edits run `mise run ui:fix`; after any code change run
  `mise run common:check:comment-types`; verify with `mise run check` and `mise run test`.
- Existing e2e test ids to preserve or migrate deliberately: `open-connection-catalog`,
  `catalog-new-<providerId>`, `catalog-method-<templateId>` (replaced in 02),
  `connection-create-submit`, `catalog-connection-<id>`. Grep
  `packages/e2e/playwright/` for each id you change.
- "Provider group" = one catalogue card (GitHub, GitHub Enterprise) grouping several template
  ids, defined in `STATIC_PROVIDERS` (`packages/ui/src/modules/connections/lib/catalog-providers.ts`).

## Whole-feature smoke test

With the UI dev server (`localhost:5173`) against a dev api-server:

1. Connection catalogue → GitHub card → **New** opens the create pane directly (no chooser
   step) with three radio options; toggling radios swaps fields in place, per
   [`design/DAM-4.png`](./design/DAM-4.png)–[`DAM-6.png`](./design/DAM-6.png).
2. Same for GitHub Enterprise, whose PAT option asks for a host.
3. Create one connection per method (PAT with a real token; GitHub App with a real app id /
   installation id / PEM if available). Rows show the method tags and, for the OAuth
   connection, the "2 steps required" callout and the install button
   ([`design/DAM.png`](./design/DAM.png), [`DAM-1.png`](./design/DAM-1.png)).
4. The GitHub App options are visible with the `advanced-connections` feature **off**;
   Spotify/Google/client-credentials stay hidden.
5. `mise run check` and `mise run test` pass.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3439. This plan folder is deleted before the PR leaves
draft (`Plan check` CI blocks merge while it exists).
