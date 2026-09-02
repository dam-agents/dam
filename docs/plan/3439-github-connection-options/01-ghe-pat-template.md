# 01 — GHE personal access token template

**Part of:** GitHub connection — one choice, three clear options — see [README](./README.md)

## Context

GitHub Enterprise offers no personal access token option (#3484), so a user with an enterprise
repository waits on an administrator. This slice adds a `github-enterprise-pat` template
server-side: header auth like `github-pat`, but with a required `host` input and the
enterprise-specific contributions (`GH_HOST` env, injects for the API and git hosts). Backend
only — the UI grouping arrives in sub-issue 02.

## Implementation plan

Apply the /typescript-engineering skill. Read `docs/architecture/connections.md` (Concepts +
Example Connections) before starting.

1. **Catalog entry** — `packages/api-server/src/modules/connections/domain/catalog.ts`.
   Model on `github-pat` (~line 646) and `github-enterprise-app` (~line 717, which already
   handles a user-supplied host with `apiBaseUrl: https://api.{host}`). New entry
   `github-enterprise-pat`: `authKind: "header"`, `category: "app"`, name/description copy
   consistent with the design's PAT option ("Paste a token you create on GitHub…"). Register it
   in `buildCatalog()` (~line 789), next to the other enterprise entries.
2. **Inputs** — `domain/connection-template.ts`, `inputsFor()` header case (~lines 281–331).
   `github-pat` presets `host` to `api.github.com` as overridable; the enterprise variant needs
   `host` **required** (the bare enterprise hostname, e.g. `ghe.acme.com`, matching what
   `github-enterprise` asks for) plus the required secret `value`. Follow how the OAuth case
   marks `host` required for `github-enterprise` (~lines 181–216).
3. **Contributions** — `domain/build-connection.ts`. `buildHeader` (~lines 491–580) emits a
   single `egress-inject` for the input host. For `github-enterprise-pat` reuse
   `githubEnterpriseHostContributions()` (~lines 205–222 — `GH_HOST` env, `api.{host}` inject,
   `{host}` basic-auth inject), the same helper the `github-enterprise` OAuth path (~line 145)
   and the github-app needs-host path (~lines 467–469) call. Prefer a third call site keyed on
   the template over generalizing `buildHeader` speculatively. Make sure the token lands on the
   enterprise hosts with the same header/value format a GHE OAuth token uses, and that no
   inject targets `api.github.com`.
4. **Contract check** — the template flows to the client through the existing
   `ConnectionTemplateView` (`packages/api-server-api/src/modules/connections/types.ts`
   ~163–174) with no new fields; `listTemplates()` returns all templates unfiltered. Nothing to
   change in `api-server-api` unless a schema enumerates template ids — grep for
   `github-pat` there to confirm.
5. Extend existing server unit tests only where a suite already enumerates templates or
   build-connection outputs (grep `packages/api-server/src/__tests__` and co-located tests for
   `github-pat`); do not author a new suite.

Note: until sub-issue 02 lands, the new template shows up in the catalogue as its own
standalone card. Acceptable mid-branch state — the feature merges as one PR.

## Acceptance criteria

- [ ] `github-enterprise-pat` is returned by `listTemplates()` with a required `host` input and
      a required secret `value` input.
- [ ] Creating a connection from it produces the GHE contribution set: `GH_HOST` env,
      `egress-inject` rows for `api.{host}` and `{host}` — mirroring what a `github-enterprise`
      OAuth grant produces, with the PAT as the injected credential.
- [ ] `github-pat` behavior is unchanged (host still presets to `api.github.com`).
- [ ] `mise run check` and `mise run test` pass; `mise run common:check:comment-types` passes.

## Smoke test

`mise run test` (api-server suite) and `mise run check`. Then, with a dev api-server running,
create a connection from the new template via the existing UI's standalone card (any hostname
and a dummy token — creation must succeed and the connection view must show the contributions;
header auth validates nothing at create today, same as `github-pat`). Print for the user: open
the Connection catalogue, pick the new GitHub Enterprise PAT card, fill host + token, create,
and confirm the connection row appears.
