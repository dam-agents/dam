# 01 — First screen and preview tool

**Part of:** The login page tells a new visitor what DAM is — see [README](./README.md)

## Context

This slice brings the prototype's first screen to `main`: the tagline and subtitle, the sign-in form, the Slack illustration on the right, background shapes, and a "Learn more" button.
It also brings the preview page, which renders the login page in the browser without Keycloak; later slices are checked with it.
The sections below the first screen come in 02.
Until then, "Learn more" scrolls to an empty `#info-bands` container.

## Implementation plan

Apply `/react-ui-engineering`.
Read prototype files with `git show origin/design/login-page:packages/keycloak-theme/<path>`.

1. **Preview tool.** Copy `preview.html`, `vite.preview.config.ts`, `src/dev-preview/preview.tsx` and `src/dev-preview/scenarios.ts`.
   Add a mise task `packages/keycloak-theme/.mise/tasks/preview` (same header style as `run` and `build`; description like "Preview the login page in the browser at http://localhost:5181, without Keycloak") that runs `pnpm exec vite --config vite.preview.config.ts`.
   Make sure the preview files are covered by `tsconfig.json` and the lint config, so `tsc --noEmit` and `check:lint` check them, and that `vite build` for the theme does not pick up `preview.html`.
   Keep `scenarios.ts` to the scenarios the preview uses (sign-in with password, SSO-only, shared-artifact sign-in, an error message); the preview can pick one with a URL parameter if `preview.tsx` makes that simple.
2. **Theme tokens.** Add `--color-accent-foreground` / `--accent-foreground` to `src/index.css` as in the prototype, with a dark value in the `.dark` block.
   **Do not** take the prototype's removal of `.dark` or its change to `src/login/hooks/use-apply-theme-script.ts`; both stay as on `main`.
3. **Components.** Copy `src/login/components/hero-bg-shapes.tsx` and `src/login/components/slack-dm-illustration.tsx`.
   Replace hard-coded light colours with theme tokens, or add `dark:` variants, so both read well in dark mode.
   Take the prototype's `social-provider-button.tsx` restyle.
4. **`src/login/pages/Login.tsx`.** Restructure as the prototype does:
   - a `LoginForm` component holding the password form, the error, the "Or" divider and the provider buttons, with `formId`, `autoFocusInput` and `dividerBgClass` props.
     Group its many props into one object type rather than repeating `LoginContext[...]` for each one;
   - **field ids:** for `formId === "kc-form-login"` the inputs keep `id="username"` / `id="password"`; any other form uses `${formId}-username` / `${formId}-password`.
     Labels follow the ids;
   - the shared-artifact branch (`isShareSignIn`) renders through `Template` as on `main` (heading, short text, one `LoginForm`, the docs link);
   - every other sign-in renders the new `ScrollPage` with the first screen (`HeroLeft`, illustration, background shapes, message, "Learn more") and an empty `<div id="info-bands" />`;
   - `ScrollPage` calls `useApplyThemeScript()` (it doesn't use `Template`) and sets `document.title` the way `Template` does.
     Export `BRAND_FALLBACK` from `Template.tsx` if needed;
   - the tagline is "Deploy Agents Massively" and the subtitle is "Work better with AI agent teammates.", as in the prototype.
5. Remove the scroll container's inline `style` in favour of Tailwind classes (`h-dvh overflow-y-auto overflow-x-hidden`).

## Acceptance criteria

- [ ] `mise run //packages/keycloak-theme:build` passes (tsc, vite build, keycloakify build).
- [ ] `mise run check`, `check:format` and `check:lint` pass.
- [ ] `mise run //packages/keycloak-theme:preview` serves the page; the first screen matches the prototype at desktop width, and at a phone width the illustration is hidden and nothing scrolls sideways.
- [ ] Dark mode works: with `?kc_theme=dark`, or the OS in dark, the page is dark with readable text, and `?kc_theme=light` switches back.
- [ ] The top form's inputs have the ids `username` and `password`.
- [ ] The shared-artifact sign-in renders the old `Template` layout.
- [ ] Nothing in `src/index.css` or `use-apply-theme-script.ts` removes dark mode.

## Smoke test

Run `mise run //packages/keycloak-theme:build` and `mise run check`.
Then run `mise run //packages/keycloak-theme:preview`, open `http://localhost:5181/` in agent-browser, and take screenshots at desktop and phone width, in light and dark.
Then run `mise run //packages/keycloak-theme:run`, open `http://localhost:8080/realms/myrealm/account` and sign in as `testuser` / `password123`.
Confirm the redirect to the account console, and that a wrong password shows the error under the fields.
Print a short guide so the user can repeat these steps.
