# The login page tells a new visitor what DAM is

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4312

## Goal

The login page is the first screen a new visitor sees, and today it only shows the tagline, a heading and the sign-in form.
After this feature it is a scrolling page: a first screen with sign-in at the top and an illustration of DAM at work in Slack, a "Learn more" button, then sections that say what an agent does, where it works (channels), what users say (testimonials), what developers and DevOps get, and a second sign-in at the bottom.
A user who already knows DAM signs in from the first screen as fast as today.
The sign-in page for a shared artifact keeps its current, simple layout.

## Approach

The login page is the Keycloakify theme in `packages/keycloak-theme` ([ADR 054](../../adrs/054-keycloak-theme.md); the login variants and their Helm values are described in [`security-and-credentials.md`](../../architecture/security-and-credentials.md), under Keycloak).
It is built separately from `packages/ui` and has its own small copies of `Button`, `Input` and `Label` under `src/components/`; this feature keeps it that way.

**The design is already built** as a prototype on the `design/login-page` branch (designs and the Ready for Dev note are on the issue).
The decision is to **copy that code and trim it**, not to rebuild it.
Read a prototype file with `git show origin/design/login-page:<path>`.
Only these prototype files are in scope; the branch's `packages/ui`, `pnpm-*` and `test-results/` changes belong to other work and are not taken:

| Prototype file (under `packages/keycloak-theme/`)                                                       | Lines            | Taken in                                          |
| ------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| `preview.html`, `vite.preview.config.ts`, `src/dev-preview/preview.tsx`, `src/dev-preview/scenarios.ts` | ~180             | 01                                                |
| `src/login/pages/Login.tsx`                                                                             | ~400             | 01 (first screen, form), 02 (sections)            |
| `src/login/components/hero-bg-shapes.tsx`, `slack-dm-illustration.tsx`                                  | ~600             | 01                                                |
| `src/login/components/social-provider-button.tsx` (restyle), `src/index.css` (`--accent-foreground`)    | small            | 01                                                |
| `src/login/components/info-bands.tsx`                                                                   | 1330             | 02                                                |
| `src/login/components/slack-team-illustration.tsx`                                                      | 913              | 02                                                |
| `src/login/components/animated-characters.tsx` (only `InteractiveCharacterWidget` and what it uses)     | 1629 → much less | 02                                                |
| `src/login/components/aurora-backdrop.tsx`, `faq-accordion.tsx`                                         | —                | **not taken** if nothing on the page renders them |

What the prototype gets wrong, and this feature does differently:

- **Dark mode stays.** The prototype deletes the `.dark` colour block in `src/index.css` and the light/dark/system logic in `src/login/hooks/use-apply-theme-script.ts`.
  Both stay as they are on `main`; every new component gets working dark styles (prefer the theme's tokens — `bg-background`, `text-foreground`, `text-muted-foreground`, `border-input`, `bg-muted` — over hard-coded colours, and add `dark:` variants where a hard-coded colour must stay).
- **The top form keeps `#username` and `#password`.** The e2e login (`packages/e2e/playwright/src/lib/auth.ts`) finds the fields by those ids.
  The prototype renames them to `<formId>-username`; instead the top form (`kc-form-login`) keeps `username` / `password`, and only the bottom form (`kc-form-login-bottom`) gets prefixed ids.
  Two forms on the page is accepted for now (production offers only the identity-provider button).
- **No testimonial photos.** The prototype imports five photos that were never committed.
  They are dropped: a testimonial shows its initials avatar (the prototype already has `initials` and `color`).
- **IBM-specific content is set per deployment**: the docs link and the community Slack link through Helm values (03), the testimonials in the platform's database, edited by operators without a redeploy (04, 05).
- **No unused code.** The prototype carries about ten character variants, a "playground", the removed integrations band and scene components no band renders.
  Only what the page renders is copied.

## Sub-issues

| #   | Title                                         | Scope                                                                                                                                                                               | Depends on |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01  | ✅ First screen and preview tool              | Preview page; first screen with background shapes, Slack illustration, the shared form, "Learn more"; top form ids kept; shared-artifact sign-in unchanged; dark mode kept          | —          |
| 02  | ✅ Content sections and bottom sign-in        | Capabilities, channels, testimonials, sandbox, DevOps and access sections with the one character widget; trimmed; initials avatars; dark styles; content from one defaults module   | 01         |
| 03  | ✅ Deployment settings for the page's content | Env vars from new `keycloak.login.*` Helm values for the docs URL, the community link and the testimonials; empty hides                                                             | 02         |
| 04  | ✅ Testimonials in the database               | `login_testimonials` table; operator tRPC to list, save and reorder; public read endpoint the login page fetches; photos in the avatar image store; Helm testimonials value removed | 03         |
| 05  | Editing testimonials                          | "Login page" card on Settings → Operator with photo upload; `dam login-testimonials` CLI with import and export; architecture pages                                                 | 04         |

Sub-issues 04 and 05 were added after 01–03 shipped on the branch: operators want to change the testimonials, photos included, without a chart upgrade.
The docs link and community link stay Helm values; only the testimonials move to the database.

## Conventions & glossary

- **First screen** — the full-height section at the top of the page: tagline, subtitle, message, sign-in form, illustration, "Learn more".
  (The prototype calls it the hero.)
- **Section** — one band below the first screen (`Band*` in the prototype).
- **Access section** — the last section, with the second sign-in form.
- **Shared-artifact sign-in** — the login page when the client is `PLATFORM_SHARE_CLIENT_ID`; it renders through `Template.tsx` as today.
- **Brand** — `realm.displayName || BRAND_FALLBACK` (`Template.tsx`), never the literal "DAM" in code.
- Imports in the theme use the `.js` suffix (as the prototype and `Template.tsx` do); keep `Login.tsx` consistent.
- Apply `/react-ui-engineering` for every component change.
  Split large files by section (one file per section under `src/login/components/sections/` is fine) rather than copying one 1,300-line file.
- **Testimonial** — one quote on the login page: name, role, quote (which may name the product as `{brand}`) and an optional photo.
- **Operator** — a user with the `keycloak.operatorRole` realm role; only an operator changes testimonials ([`security-and-credentials.md`](../../architecture/security-and-credentials.md#identity)).
- Apply `/typescript-engineering` for the api-server, api-server-api and CLI changes in 04 and 05.
- Tests are not written for this feature; verification is the build (`tsc` + `vite build` + `keycloakify build`), `mise run check`, the preview page and the e2e login.

## Whole-feature smoke test

1. `mise run //packages/keycloak-theme:build` passes; `mise run check` passes (run `check:format` and `check:lint` explicitly too).
2. The preview page (see 01) shows the whole page in light and in dark (OS preference, and `?kc_theme=dark` / `?kc_theme=light`), at desktop and at a phone width, with no horizontal scroll.
3. `mise run //packages/keycloak-theme:run`, open `http://localhost:8080/realms/myrealm/account`, sign in as `testuser` / `password123` from the top form, then sign out and sign in from the bottom form.
   A wrong password shows the error.
4. Install the branch into the local cluster (`cluster:install`) with the settings of 03 set in a values file: the docs link, community link and testimonials show those values; with them empty, those items are gone.
   The e2e login (`e2e:loop`, or one spec) signs in.
5. Open a shared artifact while signed out: its sign-in page looks as on `main`.
6. As an operator, add a testimonial with a photo on Settings → Operator, reorder it to the top, and reload the login page: it shows first, with the photo, without any redeploy.
   Remove it: it is gone on the next load.
   `dam login-testimonials import` of a JSON file replaces the list the same way.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4312.
