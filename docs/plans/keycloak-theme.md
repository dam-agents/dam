# Implementation plan: branded Keycloak login (ADR-054)

> **Working document. Delete this file in the final commit before merging the
> implementation PR — see step 10 below.**

Resolves issue [#117](https://github.com/dam-agents/dam/issues/117) per [ADR-054](../adrs/054-keycloak-theme.md).

The plan is sliced so each step is independently verifiable. Slices 1–5 are infrastructure (no user-visible change); slices 6–8 land the visible design; slice 9 layers dark mode on top. Each slice lists what to touch, what to verify, and the dependency it unblocks.

## Conventions

- New package lives at `packages/keycloak-theme/`. Top-level visibility per ADR.
- All build/run/check commands surface as `mise run keycloak-theme:*` and `mise run cluster:build-keycloak`, mirroring the patterns in [`deploy/tasks.toml`](../../deploy/tasks.toml) for ui/api-server/controller.
- Image name: `quay.io/dam-agents/keycloak` (locally: `platform-keycloak:latest`).
- Theme name (codename, baked into JAR): `platform`.

---

## Slice 1 — Package scaffold

**Touch:**
- `packages/keycloak-theme/package.json` — `keycloakify` (latest 11.x), React 18, Tailwind v4, vite, TypeScript. Workspace name `keycloak-theme`.
- `packages/keycloak-theme/vite.config.ts` — `keycloakify({ themeName: ['platform'], accountThemeImplementation: 'none', keycloakVersionTargets: <only kc-all-other-versions> })`. The exact `keycloakVersionTargets` value isn't documented for our config (login-only, account 'none'); discover by running `keycloakify build` once and seeing what targets are available, then pin to the single one we need.
- `packages/keycloak-theme/tsconfig.json` — extends `dev-config` like other packages.
- `packages/keycloak-theme/tasks.toml` — `keycloak-theme:dev` (vite), `keycloak-theme:build:jar`, `keycloak-theme:run` (`keycloakify start-keycloak`), `keycloak-theme:eject-page`, `keycloak-theme:check:*`.
- `packages/keycloak-theme/src/main.tsx`, `KcPage.tsx`, `KcContext.ts` — keycloakify boilerplate.

**Verify:** `mise run keycloak-theme:check` passes (lint + tsc). `mise run keycloak-theme:dev` renders an unstyled default Keycloak login with a mocked `kcContext`.

**Unblocks:** Slices 2 and 6.

---

## Slice 2 — Custom Keycloak image with pre-built theme JAR

The originally-planned multi-stage Docker build doesn't work: dam's standard builder image (`registry.access.redhat.com/hi/nodejs:24-builder`) can't install Maven cleanly — its `public-hummingbird-aarch64-rpms` repo has broken deps on `xmvn-toolchain-openjdk25`. Keycloakify 11.x requires Maven to package the JAR. Two ways out — a custom builder image with both Node and JDK + Maven, or build the JAR host-side via mise and bake only the runtime stage in Docker. Going with host-side, matching adk's proven pattern.

**Touch:**
- `mise.toml` — add `java = "21"` and `maven = "latest"` under `[tools]`. Mise installs on-demand; devs not touching the theme never pay the install cost.
- `packages/keycloak-theme/Dockerfile` — single-stage. `FROM quay.io/keycloak/keycloak:26.5.4@sha256:<digest>`, COPY `dist_keycloak/keycloak-theme-for-kc-all-other-versions.jar` into `/opt/keycloak/providers/keycloak-theme.jar`, RUN `/opt/keycloak/bin/kc.sh build`.
- `packages/keycloak-theme/package.json` — `build:jar` script runs `keycloakify update-kc-gen && tsc --noEmit && vite build && keycloakify build`.
- `packages/keycloak-theme/tasks.toml` — `keycloak-theme:build:jar` calls the `build:jar` npm script.

**Verify:** `mise run keycloak-theme:build:jar` produces the JAR. `docker build -f packages/keycloak-theme/Dockerfile -t platform-keycloak:latest .` succeeds. `docker run --rm --entrypoint sh platform-keycloak:latest -c "/opt/keycloak/bin/kc.sh show-config"` reports `kc.provider.file.keycloak-theme.jar.last-modified` set and `kc.optimized = true (Persisted)` — runtime startup will skip augmentation.

**Unblocks:** Slice 3.

---

## Slice 3 — Build pipeline + mise tasks

**Touch:**
- `deploy/tasks.toml`:
  - Add `image:keycloak` task (mirrors `image:ui`).
  - Add `cluster:build-keycloak` task — `docker save` + `limactl shell ... ctr images import` + `kubectl rollout restart deployment/<keycloak>`. Mirror `cluster:build-agent` structurally.
  - Add `image:keycloak` to `cluster:install` `depends`.
- `.github/workflows/cd.yml` — append `keycloak` entry to the `build-images` matrix (component, dockerfile, context). GHA cache scope `keycloak`.

**Verify:** `mise run image:keycloak` builds the local image. `mise run cluster:install` (or `cluster:build-keycloak` on an existing cluster) loads it into k3s and the keycloak pod restarts cleanly. PR-A's CI run (or a `[skip-images]` exempted preview run) shows the matrix entry executing.

**Unblocks:** Slice 4.

---

## Slice 4 — Helm wiring

**Touch:**
- `deploy/helm/platform/values.yaml` — restructure `keycloak.image` from bare string `quay.io/keycloak/keycloak:26.5.4` to:
  ```yaml
  keycloak:
    image:
      repository: quay.io/dam-agents/keycloak
      tag: ""              # defaults to .Chart.AppVersion
      pullPolicy: IfNotPresent
  ```
- `deploy/helm/platform/templates/keycloak/app.yaml` — update `image: {{ .Values.keycloak.image }}` to the structured form (matches the ui/apiServer pattern in the same file family).
- `deploy/helm/platform/values-local.yaml` — add the `pullPolicy: Never` + `repository: platform-keycloak` + `tag: latest` override block (mirrors ui/apiServer/controller).
- `deploy/helm/platform/values-dev.yaml.example` — update if it references `keycloak.image`.

**Verify:** `mise run helm:check:lint` and `mise run helm:check:render` pass. `mise run cluster:install` deploys the themed image (kubectl describe pod keycloak shows our image ref). Keycloak comes up healthy.

**Unblocks:** Slice 5.

---

## Slice 5 — Realm wiring

**Touch:**
- `deploy/helm/platform/templates/keycloak/realm-configmap.yaml` — add `"loginTheme": "platform"` to the realm JSON (next to `realm`, `enabled`, etc.).

**Verify:** After `cluster:install`, navigate to `http://keycloak.localhost:4444/realms/platform/account` or trigger the login flow from the UI. The login page renders with our (still-default-Keycloakify-looking) theme JAR, not stock Keycloak. Confirms the wiring is live.

**Unblocks:** Slice 6 (now design work has somewhere to land).

---

## Slice 6 — Login page (`login.ftl`)

**Touch:**
- `packages/keycloak-theme/src/login/pages/Login.tsx` — eject via `mise run keycloak-theme:eject-page`, rewrite to match Jenna's design (two-column: form left with email/password + SSO button area driven by `kcContext.social.providers`, animated IBM-color gradient right).
- `packages/keycloak-theme/src/login/Template.tsx` — eject if needed to provide the two-column shell. If the same shell is reused by error/info, this is the common scaffold.
- Tailwind v4 setup (`packages/keycloak-theme/src/index.css` or equivalent) — include the dark class strategy.
- Static assets (logo, fonts if not bundled) in `packages/keycloak-theme/public/`.

**Verify:**
- `mise run keycloak-theme:dev` — visual review against Jenna's design (form column, SSO buttons section visible even with empty social.providers, gradient column).
- `mise run keycloak-theme:run` (`start-keycloak`) — submit the form, get redirected on success, see error states on bad credentials.
- Mobile breakpoint: the design must work on `<768px`. Confirm the layout collapses cleanly (likely: hide gradient, form full-width).
- `mise run cluster:build-keycloak` + log into the dam UI through the themed page end-to-end.

**Unblocks:** Slice 9 (dark mode needs Login to exist).

---

## Slice 7 — Error page (`error.ftl`)

**Touch:**
- `packages/keycloak-theme/src/login/pages/Error.tsx` — eject + restyle to match design language. Likely reuses the two-column shell from Template.tsx; central column shows error message + a "back" or "retry" CTA.

**Verify:** `keycloakify start-keycloak` — trigger an error path (e.g., navigate to a bad OAuth callback URL). Visual review.

---

## Slice 8 — Info page (`info.ftl`)

**Touch:**
- `packages/keycloak-theme/src/login/pages/Info.tsx` — eject + restyle. Used for "you've been logged out", "session expired", etc.

**Verify:** `keycloakify start-keycloak` — log out from the UI and follow the redirect to see the logout-confirmation `info.ftl`. Visual review.

---

## Slice 9 — Dark mode handoff

**Touch:**
- `packages/ui/src/auth.ts` — at `userManager.signinRedirect()`, pass `extraQueryParams: { kc_theme: <current theme from store> }`. Theme store reference: the same store driving the `dark` class toggle on `<html>`.
- `packages/keycloak-theme/src/login/hooks/useApplyThemeScript.ts` (new) — port of the dark-mode handoff pattern. Inline script via `keycloakify/tools/useInsertScriptTags`, runs pre-hydration. Reads `kc_theme` URL param → falls back to `localStorage` on Keycloak's domain → falls back to `prefers-color-scheme` media query → toggles `dark` class on `<html>`. Tailwind v4 dark-class convention.
- Wire `useApplyThemeScript()` into `Template.tsx` (or wherever it runs earliest in the page lifecycle).

**Verify:**
- Toggle dark mode in the UI → trigger login redirect → Keycloak page renders in dark mode without a light-flash.
- Close browser, clear cookies on keycloak.localhost only → revisit Keycloak directly → page honors `prefers-color-scheme`.
- UI uses light theme + user navigates to Keycloak directly via bookmark → page honors localStorage if previously set, else media query.

---

## Slice 10 — Cleanup

**Touch:**
- Delete `docs/plans/keycloak-theme.md` (this file).
- Verify the implementation PR's diff is implementation-only; no planning artifacts land in `main`.

**Commit message:** `chore: drop implementation plan, work complete`.

---

## Open implementation questions (resolve during the slice that surfaces them)

- **`keycloakVersionTargets` exact shape** — discover during Slice 1. The keycloakify docs only show the option, not the value for our config.
- **Animated gradient — CSS or SVG?** — Jenna's design uses a "pulsing gradient with IBM colors." CSS `@keyframes` on a gradient background should suffice. Confirm during Slice 6 against the actual design file. Avoid video/canvas for sign-in surface (performance + accessibility).
- **SSO provider button styling** — `kcContext.social.providers` shape is `[{ providerId, displayName, loginUrl }]`. Confirm during Slice 6 whether the design provides per-IDP icons or generic buttons.
- **Mobile breakdown of the two-column** — confirm with designers if the gradient column should be hidden, scaled, or moved above/below the form on narrow screens.

---

## What's *not* in scope

Per ADR-054:

- Account, email, admin theme types.
- Pages currently unreachable in the realm flow: `login-update-password`, `login-reset-password`, `login-verify-email`, `terms`, `webauthn-*`, `idp-review-user-profile`.
- An SSO-only theme variant that hides the password form.
- i18n / non-English translations.
- Storybook.
