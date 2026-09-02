# 04 — Install detection (optional)

**Depends on:** 03-connection-row-steps
**Part of:** GitHub connection — one choice, three clear options — see [README](./README.md)

## Context

**Decision gate, not a committed slice.** Sub-issues 01–03 show the install steps from a
heuristic (`appSlug` + active), so the callout never clears — the product cannot tell whether
the app is installed on the user's organization. This slice would make "finished" real. Per the
planning decision: assess the complexity first, present the assessment to the user, and
implement only if they approve; otherwise stop after the assessment (no follow-up issue is
filed automatically — the user decides).

## Implementation plan

Apply /typescript-engineering (server) and /react-ui-engineering (UI). First produce a short
complexity assessment of the two detection avenues, then wait for the user:

- **Poll the user token.** After the OAuth callback (`packages/api-server/src/modules/
  connections/oauth-routes.ts` → `services/oauth-flow.ts` `completeOAuth`), call
  `GET /user/installations` with the fresh user access token (new method beside
  `infrastructure/github-identity.ts` `fetchUser`, ~26–48) and look for an installation of the
  operator app (match by app slug/client id; GHE variant targets `https://api.{host}`).
  Persist the result on the connection record.
- **Catch the install redirect.** GitHub redirects back with `installation_id` and
  `setup_action` query params when the app's Setup URL points at the platform; the callback
  (`oauth-routes.ts`) currently reads only `code`/`state`/`error`. Wiring this catches installs
  that happen *through our install button*, but not installs done directly on GitHub, and needs
  the operator app's Setup URL configured — assess feasibility against the deployed app config.

If approved, the shared plumbing regardless of avenue:

1. New persisted marker on the connection (e.g. `installationSeen`), surfaced through
   `connectionView` (`packages/api-server-api/src/modules/connections/types.ts` ~117–138) and
   `toView()` (`packages/api-server/src/modules/connections/services/connections-service.ts`
   ~66–114). Prefer a view field over widening the `ConnectionStatus` enum — `deriveStatus()`
   (~852–866) stays untouched and every existing status consumer keeps working.
2. A re-check path so the state can converge after the user installs: cheapest is re-running
   detection whenever the OAuth connection re-authenticates, plus an explicit re-check on
   opening the connections view (owner-scoped tRPC query beside the existing
   `probeGitHubAppInstallation` endpoints, `packages/api-server-api/src/modules/connections/
   router.ts` ~68–77).
3. UI: `activeInstallUrl()` in `components/github-app-install-hint.tsx` additionally requires
   `installationSeen === false` — callout and button disappear once the install exists.

## Acceptance criteria

- [ ] A written complexity assessment was presented and the user made the ship/skip call.
- If shipped:
- [ ] After the OAuth flow against an org where the app **is** installed, the row shows no
      steps callout and no install button.
- [ ] Where it is **not** installed, the callout shows; after installing and revisiting (or
      re-authorizing), it clears.
- [ ] `ConnectionStatus` enum unchanged; existing rows and badges unaffected.
- [ ] `mise run check`, `mise run test`, `mise run common:check:comment-types` pass.

## Smoke test

Requires a real GitHub OAuth app + installable GitHub App (staging operator credentials).
Manual: run the OAuth connect flow twice — once with the app installed on the org, once
without — and verify the callout matches reality, clearing after an install. Server side,
`mise run test` and `mise run check`. Print the two-run manual guide for the user.
