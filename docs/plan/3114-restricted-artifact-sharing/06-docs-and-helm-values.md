# 06 — Architecture docs and Helm values

**Depends on:** 01–05
**Part of:** Share an artifact with a restricted group — see [README](./README.md)

## Context

The architecture pages are the source of truth for agents, and two of their sentences are now
false: "the slug is the entire access control" and "the two origins never share cookies or
tokens" (still true, but the share origin now has a cookie of its own that needs stating).
This slice rewrites those parts, documents the new Keycloak client and env, and runs the
whole-feature smoke test. Follow `docs/guidelines/documentation-guidelines.md`.

## Implementation plan

1. `docs/architecture/artifact-library.md`:
   - Bump `Last verified`.
   - "Sharing model": add the `restricted` bullet between private and public. State: viewers
     are emails matched against the identity provider's verified email at sign-in; the owner
     always passes; the link is the same slug as public; switching between restricted and
     public keeps the link; folder pages list public only; only a person sets it, and agent
     tools refuse any sharing change on a restricted artifact.
   - Rewrite the "slug is the entire access control" sentence: for `public` it still is; for
     `restricted` the slug locates and the share session authorizes.
   - "The share host — trust boundary": add a short "Share session" paragraph: second Keycloak
     public client, authorization code + PKCE, server-side Redis session behind an `HttpOnly`
     cookie scoped to the share origin, no bearer token in the browser, app origin and share
     origin still share nothing. State that the artifact frame loads from the content host (`urls.content`), what that host does and does not serve, and why restricted frames carry a 60-second render token.
   - Rewrite the "Within a share page…" paragraph: outer page on the share host, inner document from the content host, sandbox attribute kept but no longer the boundary.
   - "Domain events → Usage": share fires on leaving private, into public or restricted.
   - "Where the code lives": add the share-auth service and routes.
2. `docs/architecture/security-and-credentials.md`: under "Identity", add the share client to
   the list of Keycloak clients with one line on what it is for. Bump `Last verified`.
3. `docs/architecture/usage-tracking.md`: only if it spells out "public" for
   `artifact_shared`; otherwise leave it.
4. `deploy/helm/platform/values.yaml`: check the `urls.content` comment from slice 01 and the `keycloak.shareClientId` comment from slice 03 explain purpose; add the client to any README table under
   `deploy/helm/platform/` that lists realm clients.
5. `docs/ubiquitous-language.md`: the Artifact Library section already carries Visibility,
   Viewer Allowlist, Restricted Share. Re-read against the shipped behaviour and adjust wording
   only if the code diverged.
6. Run `/doc-drift` against the branch and fix what it flags.
7. Run the README's whole-feature smoke test end to end and paste the outcome into the PR
   description as a checklist.
8. `mise run docs:check` (or the markdown lint task `mise tasks` lists) and
   `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `artifact-library.md` no longer claims the slug is the entire access control for every
      shared artifact, describes the share session, the third visibility, the agent refusal,
      and the folder-page rule, and has a fresh `Last verified`.
- [ ] `security-and-credentials.md` lists the share client.
- [ ] `/doc-drift` reports no drift for `docs/architecture/`.
- [ ] Whole-feature smoke test steps 1–10 pass on the dev cluster and are recorded in the PR.
- [ ] No ADR is referenced from any doc or code touched by this feature.

## Smoke test

```
mise run docs:check
```

Then the README's whole-feature smoke test, all ten steps, on the dev cluster.
