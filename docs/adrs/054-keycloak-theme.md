# ADR-054: Branded Keycloak login via Keycloakify-built custom image

**Date:** 2026-05-28
**Status:** Proposed
**Owner:** @kapetr

## Context

The Keycloak sign-in page is the first surface every user sees, and today it renders Keycloak's default theme — generic, unbranded, and visually disconnected from the rest of the product (issue #117). The team has a finalized two-column design (form left, animated gradient right) and SSO is already enabled on the deployed instance, so the new page must render IDP buttons alongside the password form on day one.

dam currently uses upstream `quay.io/keycloak/keycloak:26.5.4` with no theme configured. The decision is which theming approach to commit to and how the resulting artifact is built, shipped, and wired into the chart.

## Decision

dam's branded sign-in is built as a Keycloakify theme — React + Tailwind compiled to FTL/JAR — baked into a first-party Keycloak image. Keycloakify is chosen over raw FTL, CSS-only overrides, and replacing Keycloak's login UI because it's the only option that combines React/TS authoring with Keycloak's built-in auth flows.

- **Theme source lives in a new top-level package.** A `packages/`-level directory holds the TS source, vite config, and Dockerfile. Mirrors the precedent set by `packages/platform-base/` — a `packages/*` entry that builds a Docker image rather than a library.

- **Theme stack is Tailwind, no component library.** Login is the first page in the new design language, so there is no shared vocabulary to inherit from `packages/ui` yet. Keycloakify pins to React 18 ([keycloakify#998](https://github.com/keycloakify/keycloakify/issues/998)) while `packages/ui` is on React 19, so even when the design stabilizes, runtime component sharing is blocked until upstream catches up. Tailwind utility classes remain shareable.

- **Themed Keycloak ships as a first-party image** built and published from the new package's Dockerfile alongside ui/api-server/controller in the CD matrix. Multi-stage build: stage 1 compiles the JAR; stage 2 extends pinned upstream Keycloak (tag + digest) and runs `kc.sh build` so pod startup pays no per-boot theme assembly cost. The upstream Keycloak version moves out of `values.yaml` into the Dockerfile FROM line — single source of truth, single line to bump on Keycloak upgrades.

- **Scope is the reachable login-flow pages.** Login, error, info, and the shared template — plus theme resources (CSS, fonts). Skip account, email, and admin theme types. Pages outside the realm's current flow configuration (registration, password reset, verify-email, WebAuthn, IDP review) inherit Keycloak's default and are added when the corresponding feature ships.

- **Theme is always shipped.** The realm JSON hardcodes `"loginTheme": "platform"`. There is no Helm conditional and no documented path to deploy dam against unthemed Keycloak. Override mechanics exist but break the chart's contract — `loginTheme` would point at a theme the overridden image doesn't contain, and Keycloak would silently fall back.

- **SSO and password coexist in a single theme variant.** The login template renders the IDP button area as a first-class slot driven by `kcContext.social.providers`. An SSO-only variant that hides the password form would require a second theme + realm wiring; deferred until that requirement is concrete.

- **Theme identifier is `platform`.** Codename, not brand — matches the project-wide rule that brand strings flow through Helm values and never appear in code. Brand-shaped content (logo, copy) lives in the design assets the theme renders, not in identifiers.

- **Cross-domain dark mode handoff via OIDC query param.** The UI's `signinRedirect()` passes the active theme through OIDC extra params; an inline script in the Keycloak page reads the param before React hydration, falls back to Keycloak-domain localStorage, then to the OS media query. Implemented as the final step, after the static pages are working.

## Alternatives Considered

- **Plain FTL with CSS overrides** — Cheapest, but the two-column layout requires structural markup changes that hand-written FTL doesn't pleasantly support, and the result is unmaintainable as the design evolves.
- **CSS-only theme** — Cannot restructure markup to two-column without touching templates.
- **Replace Keycloak's login UI with our own React page** (ROPC, AuthN endpoints) — Drops Keycloak's brute-force protection, required-action handling, and SSO callback flow; forces us to reimplement the auth surface we're using Keycloak for.
- **Mount the theme JAR at runtime via ConfigMap or PVC** — JAR exceeds the 1MiB ConfigMap limit; PVC adds operational overhead; either way pod startup pays for on-boot `kc.sh build`.
- **Init container that builds the theme on first boot** — Adds 10-30s to every Keycloak pod start; Keycloak 26 explicitly recommends build-time provider augmentation.
- **Two theme variants (sso vs non-sso) from day one** — Premature; SSO and password coexist cleanly in a single template via `kcContext.social.providers`. If an SSO-only page that hides the password form is ever required, the right approach should be re-evaluated against current Keycloak capabilities (authentication flow customization, per-client theme overrides, Identity-First / Organizations features) before committing to a second theme variant.

## Consequences

- **Easier:** Bumping Keycloak is a one-line `FROM` edit in the theme package's Dockerfile — the upstream version stops being duplicated between Helm values and any other surface.
- **Easier:** Adding the next themed login-flow page (login-update-password, WebAuthn, IDP review) reuses the established template/component scaffolding — keycloakify's `eject-page` produces a typed React component scoped to a single FTL contract.
- **Easier:** Local theme iteration runs at vite-dev speed against a mocked `kcContext`, decoupled from cluster restarts; full-cluster verification is a single `mise` task when needed.
- **Easier:** No regression risk on existing tests — the repo has no browser/Playwright tests that depend on Keycloak HTML, and CLI auth tests use the device-grant flow which never renders the login page.

- **Harder:** dam now publishes and maintains a Keycloak image. Upstream Keycloak releases require rebuilding our image, retesting the theme against the new FTL contract, and re-pinning the FROM digest — a new maintenance touchpoint that didn't exist before.
- **Harder:** The theme package is locked to React 18 until [keycloakify#998](https://github.com/keycloakify/keycloakify/issues/998) lands. Runtime component sharing with `packages/ui` (React 19) is blocked; Tailwind utility classes are the only shareable layer.
- **Harder:** The `values.yaml` shape for `keycloak.image` changes from a bare string to `{repository, tag, pullPolicy}` (matching ui/apiServer/controller). This is a breaking values change for any external override of the Keycloak image.
- **Harder:** Dark mode handoff couples the UI and the theme through the OIDC `kc_theme` URL param contract — renaming the param or changing its values requires synchronized deploys of both components.

- **Committed-to:** Keycloakify as the theming engine. Switching later (raw FTL, a different React-based theme tool) means rewriting every themed page.
- **Committed-to:** A dam-owned Keycloak image in the chart. The chart's contract assumes the themed image; "unthemed dam" is not a supported deployment.
- **Committed-to:** The `platform` theme identifier baked into the JAR's directory layout. Renaming requires republishing the image and updating the realm JSON in sync.
